/* Presentation-only feedback. Persistence and scheduling stay in index.html. */
(() => {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const animate = (element, frames, duration = 280) => {
    if (!element || reduced.matches || !element.animate) return;
    return element.animate(frames, {duration, easing:'cubic-bezier(.22,1,.36,1)'});
  };
  window.WorkspaceUI = {
    capture() {
      const state = window.AppState;
      if (!state) return;
      for (const [kind, prefix] of [['question','q'],['answer','a']]) {
        document.getElementById(prefix+'Paste')?.closest('.capture-panel')?.classList.toggle('has-images', state[kind].length > 0);
      }
      const ready = state.question.length > 0 && state.answer.length > 0;
      const footer = document.querySelector('.capture-footer');
      footer?.classList.toggle('ready',ready);
      const summary = footer?.querySelector('span');
      if (summary) summary.textContent = state.processing ? '正在处理图片，请稍候…' : ready ? `已就绪 · ${state.question.length} 张题目 / ${state.answer.length} 张答案` : state.question.length ? '题目已收好，再添加答案就可以保存' : state.answer.length ? '答案已收好，再添加题目就可以保存' : '先放入题目，再收好答案';
      const save = document.getElementById('save');
      if (save) {
        save.textContent = state.loadingEdit ? '正在读取错题…' : state.saving ? '正在保存…' : state.processing ? '正在处理图片…' : state.editId ? '保存修改' : '保存这道错题';
        save.setAttribute('aria-busy',String(!!(state.loadingEdit || state.saving || state.processing)));
      }
    },
    result(result) {
      const counter = document.getElementById('done');
      animate(counter, [{transform:'scale(1)',color:'#287353'},{transform:'scale(1.22)',color:result === 'wrong' ? '#b94d30' : '#287353'},{transform:'scale(1)',color:'#287353'}],360);
    },
    nextQuestion() {
      const review = document.querySelector('.review-top');
      if (review && review.getBoundingClientRect().top < 0) review.scrollIntoView({block:'start',behavior:'instant'});
    },
    empty(reason) {
      const card = document.getElementById('reviewEmptyCard');
      if (card) card.dataset.reason = reason;
    },
    dismissToast(element) {
      if (reduced.matches) { element.remove(); return; }
      element.classList.add('leaving');
      setTimeout(() => element.remove(),180);
    }
  };
  const today = document.getElementById('workspaceDate');
  if (today) today.textContent = new Intl.DateTimeFormat('zh-CN',{month:'long',day:'numeric',weekday:'long'}).format(new Date());
  const menu = document.getElementById('menu');
  const mobileNav = document.getElementById('mobileNav');
  const closeMenu = () => {
    mobileNav?.classList.remove('open');
    menu?.setAttribute('aria-expanded','false');
    menu?.setAttribute('aria-label','打开菜单');
  };
  menu?.setAttribute('aria-controls','mobileNav');
  menu?.addEventListener('click', () => {
    const open = mobileNav?.classList.toggle('open') ?? false;
    menu.setAttribute('aria-expanded',String(open));
    menu.setAttribute('aria-label',open ? '关闭菜单' : '打开菜单');
  });
  document.addEventListener('click', event => {
    if (event.target.closest('[data-route]') || !event.target.closest('.topbar')) closeMenu();
  },true);
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && mobileNav?.classList.contains('open')) { closeMenu(); menu?.focus(); }
  });
  window.WorkspaceUI.capture();
})();
