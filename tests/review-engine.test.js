const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const html = fs.readFileSync(require('node:path').join(__dirname, '..', 'index.html'), 'utf8');
const source = html.match(/\/\* REVIEW_ENGINE_START \*\/(.*?)\/\* REVIEW_ENGINE_END \*\//s)[1];
const ReviewEngine = Function('window', 'AppState', `${source}; return ReviewEngine;`)({}, {reviewState:{emptyReason:null}});
const day = 86400000;
const base = {id:'q',questionImages:[{fileName:'q.webp'}],answerImages:[{fileName:'a.webp'}],hidden:false,nextReviewAt:1000,lastReviewedAt:1000,correctStreak:0,lastResult:null};

test('correct intervals are 1, 3, 7, 14, 30 days and stay capped', () => {
  for (let streak = 0; streak <= 6; streak++) {
    const q = {...base, correctStreak:streak};
    const patch = ReviewEngine.applyResult(q, 'correct', 1000);
    assert.equal(patch.nextReviewAt, 1000 + [1,3,7,14,30][Math.min(streak,4)] * day);
  }
});

test('wrong resets streak and schedules 24 hours later', () => {
  const patch = ReviewEngine.applyResult({...base,correctStreak:4}, 'wrong', 5000);
  assert.deepEqual(patch, {correctStreak:0,lastResult:'wrong',lastReviewedAt:5000,nextReviewAt:5000+day});
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

test('new, wrong and more overdue questions receive higher bounded weights', () => {
  const now = 31 * day;
  const fresh = {...base,lastReviewedAt:null,nextReviewAt:now};
  const wrong = {...base,lastResult:'wrong',nextReviewAt:now-day};
  const older = {...base,nextReviewAt:now-20*day};
  assert.ok(ReviewEngine.weight(fresh, now) > 1);
  assert.ok(ReviewEngine.weight(wrong, now) > ReviewEngine.weight({...base,nextReviewAt:now}, now));
  assert.ok(ReviewEngine.weight(older, now) > ReviewEngine.weight({...base,nextReviewAt:now-day}, now));
  assert.ok(ReviewEngine.weight({...base,nextReviewAt:now-1000*day}, now) <= 12);
});

test('weighted picker handles empty input and deterministic boundaries', () => {
  assert.equal(ReviewEngine.pickWeighted([], () => 0), null);
  const items = ReviewEngine.weightedCandidates([{...base,id:'a'},{...base,id:'b'}], 1000);
  assert.equal(ReviewEngine.pickWeighted(items, () => 0).id, 'a');
  assert.equal(ReviewEngine.pickWeighted(items, () => 0.999999).id, 'b');
});

test('20 equal new questions produce a non-fixed distribution across 1000 weighted draws', () => {
  let seed = 0x12345678;
  const random = () => ((seed = (1664525 * seed + 1013904223) >>> 0) / 0x100000000);
  const now = 100000;
  const questions = Array.from({length:20}, (_,i) => ({...base,id:`q-${i}`,createdAt:i,lastReviewedAt:null,nextReviewAt:now}));
  const candidates = ReviewEngine.weightedCandidates(ReviewEngine.dueQuestions(questions,new Set(),now),now);
  const counts = new Map(questions.map(q => [q.id,0]));
  const order = [];
  for (let i=0;i<1000;i++) {
    const picked = ReviewEngine.pickWeighted(candidates, random);
    counts.set(picked.id, counts.get(picked.id)+1);
    order.push(picked.id);
  }
  assert.equal([...counts.values()].filter(Boolean).length, 20);
  assert.ok(new Set(order.slice(0,100)).size > 1);
  assert.notDeepEqual(order.slice(0,20), questions.map(q => q.id));
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
