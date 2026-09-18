const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const html = fs.readFileSync(require('node:path').join(__dirname, '..', 'index.html'), 'utf8');
const source = html.match(/\/\* REVIEW_ENGINE_START \*\/(.*?)\/\* REVIEW_ENGINE_END \*\//s)[1];
const ReviewEngine = Function('window', 'AppState', `${source}; return ReviewEngine;`)({}, {reviewState:{emptyReason:null}});
const day = 86400000;
const base = {id:'q',questionImages:[{fileName:'q.webp'}],answerImages:[{fileName:'a.webp'}],hidden:false,nextReviewAt:1000,lastReviewedAt:1000,correctStreak:0,lastResult:null};

test('correct intervals are 7, 7, 7, 14, 30 days and stay capped', () => {
  for (let streak = 0; streak <= 6; streak++) {
    const q = {...base, correctStreak:streak};
    const patch = ReviewEngine.applyResult(q, 'correct', 1000);
    assert.equal(patch.nextReviewAt, 1000 + [7,7,7,14,30][Math.min(streak,4)] * day);
  }
});

test('wrong resets streak and schedules seven days later', () => {
  const patch = ReviewEngine.applyResult({...base,correctStreak:4}, 'wrong', 5000);
  assert.deepEqual(patch, {correctStreak:0,lastResult:'wrong',lastReviewedAt:5000,nextReviewAt:5000+7*day});
});

test('a completed question is not due again before seven days', () => {
  const at = 5000;
  for (const result of ['correct', 'wrong']) {
    const patch = ReviewEngine.applyResult(base, result, at);
    assert.deepEqual(ReviewEngine.dueQuestions([{...base, ...patch}], new Set(), at + 7 * day - 1), []);
    assert.equal(ReviewEngine.dueQuestions([{...base, ...patch}], new Set(), at + 7 * day).length, 1);
  }
});

test('hide keeps the question and image metadata but marks it hidden', () => {
  const question = {...base,questionImages:[{fileName:'q.webp'}],answerImages:[{fileName:'a.webp'}]};
  const patch = ReviewEngine.applyResult(question, 'hide', 5000);
  assert.equal(patch.hidden, true);
  assert.deepEqual(question.questionImages, [{fileName:'q.webp'}]);
  assert.deepEqual(question.answerImages, [{fileName:'a.webp'}]);
});

test('hidden, future, malformed and seen questions are excluded', () => {
  const now = 100000;
  const candidates = ReviewEngine.dueQuestions([
    {...base,id:'ok',nextReviewAt:now}, {...base,id:'hidden',hidden:true,nextReviewAt:now},
    {...base,id:'future',nextReviewAt:now+1}, {...base,id:'no-q',questionImages:[]},
    {...base,id:'no-a',answerImages:[]}, {...base,id:'bad-time',nextReviewAt:NaN}
  ], new Set(['ok']), now);
  assert.deepEqual(candidates, []);
});

test('new, wrong and correct questions use the specified layered overdue weights', () => {
  const now = 31 * day;
  const fresh = {...base,lastReviewedAt:null,lastResult:'correct',nextReviewAt:now};
  const unresulted = {...base,lastReviewedAt:now-day,lastResult:null,nextReviewAt:now};
  const wrong = {...base,lastResult:'wrong',nextReviewAt:now};
  const correct = {...base,lastResult:'correct',nextReviewAt:now};
  assert.equal(ReviewEngine.weight(fresh, now), 9);
  assert.equal(ReviewEngine.weight(unresulted, now), 9);
  assert.equal(ReviewEngine.weight(wrong, now), 4);
  assert.equal(ReviewEngine.weight(correct, now), 1);
  assert.equal(ReviewEngine.weight({...correct,nextReviewAt:now-20*day}, now), 3);
  assert.equal(ReviewEngine.weight({...correct,nextReviewAt:now-1000*day}, now), 4);
});

test('weighted picker handles empty input and deterministic boundaries', () => {
  assert.equal(ReviewEngine.pickWeighted([], () => 0), null);
  const items = ReviewEngine.weightedCandidates([{...base,id:'a'},{...base,id:'b'}], 1000);
  assert.equal(ReviewEngine.pickWeighted(items, () => 0).id, 'a');
  assert.equal(ReviewEngine.pickWeighted(items, () => 0.999999).id, 'b');
});

test('10 new, 10 wrong and 10 correct questions follow priority and remain random within each category', () => {
  let seed = 0x12345678;
  const random = () => ((seed = (1664525 * seed + 1013904223) >>> 0) / 0x100000000);
  const now = 100000;
  const questions = [
    ...Array.from({length:10}, (_,i) => ({...base,id:`new-${i}`,createdAt:i,lastReviewedAt:null,lastResult:null,nextReviewAt:now})),
    ...Array.from({length:10}, (_,i) => ({...base,id:`wrong-${i}`,createdAt:i,lastReviewedAt:now-day,lastResult:'wrong',nextReviewAt:now})),
    ...Array.from({length:10}, (_,i) => ({...base,id:`correct-${i}`,createdAt:i,lastReviewedAt:now-day,lastResult:'correct',nextReviewAt:now}))
  ];
  const candidates = ReviewEngine.weightedCandidates(ReviewEngine.dueQuestions(questions,new Set(),now),now);
  const counts = new Map(questions.map(q => [q.id,0]));
  const order = [];
  const categories = {new:0,wrong:0,correct:0};
  const categoryIds = {new:new Set(),wrong:new Set(),correct:new Set()};
  for (let i=0;i<5000;i++) {
    const picked = ReviewEngine.pickWeighted(candidates, random);
    counts.set(picked.id, counts.get(picked.id)+1);
    order.push(picked.id);
    const category = picked.id.split('-')[0];
    categories[category]++;
    categoryIds[category].add(picked.id);
  }
  assert.ok(categories.new > categories.wrong && categories.wrong > categories.correct, JSON.stringify(categories));
  assert.ok(Object.values(categoryIds).every(ids => ids.size > 1));
  assert.notDeepEqual(order.slice(0,30), questions.map(q => q.id));
});

test('session only excludes ids recorded after a successful submission', () => {
  const repository = {current:{revision:1,questions:[{...base,id:'a',nextReviewAt:0},{...base,id:'b',nextReviewAt:0} ]}};
  const session = {revision:1,seenIds:new Set(),done:0,currentId:null,completed:false};
  const first = ReviewEngine.next(repository, session, 100, () => 0);
  assert.equal(session.seenIds.size, 0);
  session.seenIds.add(first.id);
  const second = ReviewEngine.next(repository, session, 100, () => 0);
  session.seenIds.add(second.id);
  assert.notEqual(first.id, second.id);
  assert.equal(ReviewEngine.next(repository, session, 100, () => 0), null);
});
