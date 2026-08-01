'use strict';

const STORAGE_KEY = 'trafficSignsPersonalDataV1';
const DAY = 86400000;
let signs = [];
let learnQueue = [];
let learnIndex = 0;
let quiz = null;
let deferredInstallPrompt = null;

const state = loadState();

function defaultState() {
  return { progress: {}, correct: 0, wrong: 0, tests: 0, favorites: [], streak: 0, lastStudyDate: null };
}

function loadState() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return { ...defaultState(), ...(parsed || {}) };
  } catch {
    return defaultState();
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  updateStats();
}

function escapeHtml(value = '') {
  return String(value).replace(/[&<>'"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[ch]));
}

function signVisual(sign, lazy = false) {
  const loading = lazy ? 'loading="lazy"' : '';
  const alt = escapeHtml(`תמרור ${sign.number}: ${sign.name}`);
  return `<img ${loading} src="${escapeHtml(sign.image)}" alt="${alt}" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'image-error',textContent:'${escapeHtml(sign.number)}'}))">`;
}

async function init() {
  try {
    const response = await fetch('./data/signs.json', { cache: 'no-cache' });
    if (!response.ok) throw new Error('לא ניתן לטעון את המאגר');
    signs = await response.json();
    if (!Array.isArray(signs) || !signs.length) throw new Error('המאגר ריק');
  } catch (error) {
    document.body.innerHTML = `<main><section class="card"><h2>שגיאת טעינה</h2><p>${escapeHtml(error.message)}. יש להפעיל את המערכת דרך GitHub Pages או שרת מקומי.</p></section></main>`;
    return;
  }

  setupNavigation();
  setupInstall();
  fillCategorySelects();
  setupLearn();
  setupQuiz();
  setupCatalog();
  setupDataTools();
  updateStats();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(console.warn);
  }
}

function setupNavigation() {
  document.querySelectorAll('.tab').forEach(btn => btn.addEventListener('click', () => showView(btn.dataset.view)));
  document.querySelectorAll('[data-go]').forEach(btn => btn.addEventListener('click', () => showView(btn.dataset.go)));
}

function showView(id) {
  document.querySelectorAll('.view').forEach(view => view.classList.toggle('active', view.id === id));
  document.querySelectorAll('.tab').forEach(tab => tab.classList.toggle('active', tab.dataset.view === id));
  window.scrollTo({ top: 0, behavior: 'smooth' });
  if (id === 'catalog') renderCatalog();
  if (id === 'stats') updateStats();
}

function setupInstall() {
  const button = document.getElementById('installBtn');
  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    deferredInstallPrompt = event;
    button.classList.remove('hidden');
  });
  button.addEventListener('click', async () => {
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    button.classList.add('hidden');
  });
}

function categories() {
  return [...new Set(signs.map(sign => sign.category))];
}

function fillCategorySelects() {
  for (const id of ['learnCategory', 'quizCategory', 'categoryFilter']) {
    const select = document.getElementById(id);
    categories().forEach(category => {
      const option = document.createElement('option');
      option.value = category;
      option.textContent = category;
      select.appendChild(option);
    });
  }
}

function signProgress(number) {
  return state.progress[number] || { reviews: 0, score: 0, correct: 0, wrong: 0, nextReview: 0 };
}

function sortByDue(a, b) {
  const ap = signProgress(a.number);
  const bp = signProgress(b.number);
  if (ap.reviews === 0 && bp.reviews !== 0) return -1;
  if (bp.reviews === 0 && ap.reviews !== 0) return 1;
  return (ap.nextReview || 0) - (bp.nextReview || 0) || ap.score - bp.score;
}

function rebuildLearnQueue(shuffleQueue = false) {
  const category = document.getElementById('learnCategory').value;
  const pool = signs.filter(sign => category === 'all' || sign.category === category);
  learnQueue = shuffleQueue ? shuffle(pool) : [...pool].sort(sortByDue);
  learnIndex = 0;
  renderFlashcard();
}

function setupLearn() {
  document.getElementById('showAnswer').addEventListener('click', () => document.getElementById('flashAnswer').classList.remove('hidden'));
  document.querySelectorAll('[data-rating]').forEach(button => button.addEventListener('click', () => rateSign(button.dataset.rating)));
  document.getElementById('shuffleLearn').addEventListener('click', () => rebuildLearnQueue(true));
  document.getElementById('learnCategory').addEventListener('change', () => rebuildLearnQueue(false));
  rebuildLearnQueue(false);
}

function renderFlashcard() {
  if (!learnQueue.length) {
    document.getElementById('flashVisual').innerHTML = '<div class="empty-state">אין תמרורים בקבוצה זו</div>';
    document.getElementById('flashTitle').textContent = '';
    document.getElementById('flashCategory').textContent = '';
    document.getElementById('showAnswer').classList.add('hidden');
    return;
  }
  document.getElementById('showAnswer').classList.remove('hidden');
  const sign = learnQueue[learnIndex % learnQueue.length];
  document.getElementById('flashVisual').innerHTML = signVisual(sign);
  document.getElementById('flashCategory').textContent = sign.category;
  document.getElementById('flashTitle').textContent = `${sign.number} — ${sign.name}`;
  document.getElementById('flashMeaning').textContent = sign.meaning;
  document.getElementById('flashAction').textContent = `פעולת הנהג: ${sign.action}`;
  document.getElementById('flashAnswer').classList.add('hidden');
}

function rateSign(rating) {
  if (!learnQueue.length) return;
  const sign = learnQueue[learnIndex % learnQueue.length];
  const progress = signProgress(sign.number);
  const intervals = {
    again: 0,
    hard: Math.min(7, Math.max(1, Math.round(Math.pow(1.7, progress.reviews)))),
    good: Math.min(45, Math.max(1, Math.round(Math.pow(2, progress.reviews))))
  };
  progress.reviews += 1;
  progress.score = rating === 'again'
    ? Math.max(0, progress.score - 15)
    : Math.min(100, progress.score + (rating === 'hard' ? 7 : 15));
  progress.nextReview = Date.now() + intervals[rating] * DAY;
  if (rating === 'again') {
    progress.wrong += 1;
    state.wrong += 1;
  } else {
    progress.correct += 1;
    state.correct += 1;
  }
  state.progress[sign.number] = progress;
  markStudyDay();
  saveState();
  learnIndex += 1;
  renderFlashcard();
}

function markStudyDay() {
  const today = localDateKey(new Date());
  if (state.lastStudyDate === today) return;
  const yesterday = localDateKey(new Date(Date.now() - DAY));
  state.streak = state.lastStudyDate === yesterday ? state.streak + 1 : 1;
  state.lastStudyDate = today;
}

function localDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function setupQuiz() {
  document.getElementById('startQuiz').addEventListener('click', startQuiz);
  document.getElementById('nextQuestion').addEventListener('click', nextQuizQuestion);
  ['quizCategory', 'quizMode'].forEach(id => document.getElementById(id).addEventListener('change', updateQuizAvailability));
  updateQuizAvailability();
}

function quizPool() {
  const category = document.getElementById('quizCategory').value;
  const mode = document.getElementById('quizMode').value;
  let pool = signs.filter(sign => category === 'all' || sign.category === category);
  if (mode === 'weak') pool = pool.filter(sign => signProgress(sign.number).reviews > 0 && signProgress(sign.number).score < 70);
  if (mode === 'wrong') pool = pool.filter(sign => signProgress(sign.number).wrong > 0);
  if (mode === 'favorites') pool = pool.filter(sign => state.favorites.includes(sign.number));
  return pool;
}

function updateQuizAvailability() {
  if (!signs.length) return;
  const count = quizPool().length;
  const text = count ? `${count} תמרורים זמינים לבחירה` : 'אין עדיין תמרורים מתאימים. בחר מבחן אקראי או תרגל תחילה.';
  document.getElementById('quizAvailability').textContent = text;
  document.getElementById('startQuiz').disabled = count === 0;
}

function startQuiz() {
  const pool = quizPool();
  if (!pool.length) return;
  const requested = Number(document.getElementById('quizLength').value);
  const count = Math.min(requested, pool.length);
  quiz = { questions: shuffle(pool).slice(0, count), index: 0, score: 0, answered: false, mistakes: [] };
  document.getElementById('quizStart').classList.add('hidden');
  document.getElementById('quizResult').classList.add('hidden');
  document.getElementById('quizBox').classList.remove('hidden');
  renderQuizQuestion();
}

function renderQuizQuestion() {
  const sign = quiz.questions[quiz.index];
  quiz.answered = false;
  document.getElementById('quizVisual').innerHTML = signVisual(sign);
  document.getElementById('quizCounter').textContent = `שאלה ${quiz.index + 1} מתוך ${quiz.questions.length} · תמרור ${sign.number}`;
  document.getElementById('quizProgress').style.width = `${(quiz.index / quiz.questions.length) * 100}%`;
  document.getElementById('feedback').classList.add('hidden');
  document.getElementById('nextQuestion').classList.add('hidden');

  const sameCategory = signs.filter(candidate => candidate.number !== sign.number && candidate.category === sign.category);
  const fallback = signs.filter(candidate => candidate.number !== sign.number && !sameCategory.includes(candidate));
  const alternatives = shuffle([sign, ...shuffle(sameCategory).slice(0, 3), ...shuffle(fallback).slice(0, 3)]).slice(0, 4);
  if (!alternatives.some(candidate => candidate.number === sign.number)) alternatives[0] = sign;

  const box = document.getElementById('answers');
  box.innerHTML = '';
  shuffle(alternatives).forEach(option => {
    const button = document.createElement('button');
    button.className = 'answer';
    button.dataset.number = option.number;
    button.textContent = option.name;
    button.addEventListener('click', () => answerQuiz(option.number, button));
    box.appendChild(button);
  });
}

function answerQuiz(number, clicked) {
  if (quiz.answered) return;
  quiz.answered = true;
  const sign = quiz.questions[quiz.index];
  const correct = number === sign.number;

  document.querySelectorAll('.answer').forEach(button => {
    if (button.dataset.number === sign.number) button.classList.add('correct');
    button.disabled = true;
  });
  if (!correct) clicked.classList.add('wrong');

  const progress = signProgress(sign.number);
  progress.reviews += 1;
  if (correct) {
    quiz.score += 1;
    state.correct += 1;
    progress.correct += 1;
    progress.score = Math.min(100, progress.score + 10);
    progress.nextReview = Date.now() + 3 * DAY;
  } else {
    state.wrong += 1;
    progress.wrong += 1;
    progress.score = Math.max(0, progress.score - 12);
    progress.nextReview = Date.now();
    quiz.mistakes.push(sign.number);
  }
  state.progress[sign.number] = progress;

  const feedback = document.getElementById('feedback');
  feedback.className = `feedback ${correct ? 'success-soft' : 'danger-soft'}`;
  feedback.innerHTML = `<strong>${correct ? 'נכון!' : `לא נכון. התשובה: ${escapeHtml(sign.name)}`}</strong><br>${escapeHtml(sign.meaning)}<br><small>${escapeHtml(sign.action)}</small>`;
  feedback.classList.remove('hidden');
  document.getElementById('nextQuestion').classList.remove('hidden');
  markStudyDay();
  saveState();
}

function nextQuizQuestion() {
  quiz.index += 1;
  if (quiz.index < quiz.questions.length) renderQuizQuestion();
  else finishQuiz();
}

function finishQuiz() {
  state.tests += 1;
  saveState();
  document.getElementById('quizBox').classList.add('hidden');
  const result = document.getElementById('quizResult');
  result.classList.remove('hidden');
  const percent = Math.round((quiz.score / quiz.questions.length) * 100);
  const mistakeText = quiz.mistakes.length ? `<p class="muted">לתרגול נוסף: ${quiz.mistakes.map(escapeHtml).join(', ')}</p>` : '<p class="muted">לא היו טעויות במבחן.</p>';
  result.innerHTML = `<h2>${percent >= 80 ? 'כל הכבוד!' : 'כדאי להמשיך לתרגל'}</h2><p>ענית נכון על <strong>${quiz.score}</strong> מתוך <strong>${quiz.questions.length}</strong> שאלות — ${percent}%.</p>${mistakeText}<button class="primary" id="againQuiz">מבחן נוסף</button>`;
  document.getElementById('againQuiz').addEventListener('click', () => {
    result.classList.add('hidden');
    document.getElementById('quizStart').classList.remove('hidden');
    updateQuizAvailability();
  });
}

function setupCatalog() {
  ['searchInput', 'categoryFilter', 'artworkFilter'].forEach(id => document.getElementById(id).addEventListener('input', renderCatalog));
  const dialog = document.getElementById('signDialog');
  document.getElementById('closeDialog').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', event => {
    const rect = dialog.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
  });
  renderCatalog();
}

function renderCatalog() {
  const query = document.getElementById('searchInput').value.trim().toLowerCase();
  const category = document.getElementById('categoryFilter').value;
  const artwork = document.getElementById('artworkFilter').value;
  const filtered = signs.filter(sign => {
    const haystack = `${sign.number} ${sign.name} ${sign.meaning} ${sign.action} ${sign.category}`.toLowerCase();
    return (!query || haystack.includes(query)) && (category === 'all' || sign.category === category) && (artwork === 'all' || sign.artwork === artwork);
  });

  document.getElementById('catalogCount').textContent = `מציג ${filtered.length} מתוך ${signs.length}`;
  const grid = document.getElementById('catalogGrid');
  grid.innerHTML = '';

  if (!filtered.length) {
    grid.innerHTML = '<div class="card empty-state">לא נמצאו תמרורים התואמים לחיפוש.</div>';
    return;
  }

  const fragment = document.createDocumentFragment();
  filtered.forEach(sign => {
    const article = document.createElement('article');
    article.className = 'sign-card card';
    const isFavorite = state.favorites.includes(sign.number);
    article.innerHTML = `
      <button class="favorite" aria-label="${isFavorite ? 'הסרה מהמועדפים' : 'הוספה למועדפים'}">${isFavorite ? '★' : '☆'}</button>
      <div class="sign-stage">${signVisual(sign, true)}</div>
      <div class="card-badges"><span class="badge">${escapeHtml(sign.number)}</span>${sign.artwork === 'schematic' ? '<span class="badge secondary-badge">איור לימודי</span>' : ''}</div>
      <h3>${escapeHtml(sign.name)}</h3>
      <p>${escapeHtml(shorten(sign.meaning, 130))}</p>
      <button class="secondary details">פרטים</button>`;
    article.querySelector('.favorite').addEventListener('click', event => {
      event.stopPropagation();
      toggleFavorite(sign.number);
      renderCatalog();
    });
    article.querySelector('.details').addEventListener('click', () => openSignDialog(sign));
    fragment.appendChild(article);
  });
  grid.appendChild(fragment);
}

function openSignDialog(sign) {
  document.getElementById('dialogVisual').innerHTML = signVisual(sign);
  document.getElementById('dialogNumber').textContent = sign.number;
  document.getElementById('dialogArtwork').textContent = sign.artwork === 'schematic' ? 'איור לימודי סכמטי' : 'איור מגיליון המקור';
  document.getElementById('dialogTitle').textContent = sign.name;
  document.getElementById('dialogMeaning').textContent = sign.meaning;
  document.getElementById('dialogAction').textContent = `פעולת הנהג: ${sign.action}`;
  document.getElementById('dialogValidity').textContent = `תחולה כללית: ${sign.validity}`;
  document.getElementById('dialogSource').textContent = `מקור המאגר: ${sign.source}${sign.sourcePage ? ` · עמוד ${sign.sourcePage}` : ''}`;
  document.getElementById('signDialog').showModal();
}

function toggleFavorite(number) {
  const index = state.favorites.indexOf(number);
  if (index >= 0) state.favorites.splice(index, 1);
  else state.favorites.push(number);
  saveState();
  updateQuizAvailability();
}

function updateStats() {
  if (!signs.length) return;
  const learned = Object.values(state.progress).filter(progress => progress.reviews > 0).length;
  const due = signs.filter(sign => {
    const progress = signProgress(sign.number);
    return progress.reviews > 0 && (progress.nextReview || 0) <= Date.now();
  }).length;
  document.getElementById('signTotal').textContent = signs.length;
  document.getElementById('learnedTotal').textContent = learned;
  document.getElementById('dueTotal').textContent = due;
  document.getElementById('streakTotal').textContent = state.streak || 0;
  document.getElementById('correctTotal').textContent = state.correct || 0;
  document.getElementById('wrongTotal').textContent = state.wrong || 0;
  document.getElementById('testsTotal').textContent = state.tests || 0;
  document.getElementById('favoritesTotal').textContent = state.favorites.length;

  const weak = signs
    .filter(sign => signProgress(sign.number).reviews > 0 && signProgress(sign.number).score < 70)
    .sort((a, b) => signProgress(a.number).score - signProgress(b.number).score)
    .slice(0, 12);
  const box = document.getElementById('weakSigns');
  box.innerHTML = weak.length
    ? weak.map(sign => `<div class="weak-item"><span><strong>${escapeHtml(sign.number)}</strong> — ${escapeHtml(sign.name)}</span><span>${signProgress(sign.number).score}%</span></div>`).join('')
    : '<p class="muted">לא נצברו עדיין מספיק נתונים. התחל בכרטיסיות או במבחן.</p>';
}

function setupDataTools() {
  document.getElementById('exportData').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), data: state }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `traffic-signs-backup-${localDateKey(new Date())}.json`;
    link.click();
    URL.revokeObjectURL(url);
  });

  document.getElementById('importData').addEventListener('change', async event => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      const imported = parsed.data || parsed;
      if (!imported.progress || !Array.isArray(imported.favorites)) throw new Error('מבנה קובץ לא תקין');
      Object.assign(state, defaultState(), imported);
      saveState();
      rebuildLearnQueue(false);
      alert('הגיבוי יובא בהצלחה.');
    } catch (error) {
      alert(`לא ניתן לייבא את הקובץ: ${error.message}`);
    }
    event.target.value = '';
  });

  document.getElementById('resetData').addEventListener('click', () => {
    if (!confirm('למחוק את כל הציונים, הטעויות והמועדפים?')) return;
    Object.assign(state, defaultState());
    saveState();
    rebuildLearnQueue(false);
    renderCatalog();
    updateQuizAvailability();
  });
}

function shorten(text, max) {
  return text.length <= max ? text : `${text.slice(0, max - 1).trim()}…`;
}

function shuffle(items) {
  const array = [...items];
  for (let index = array.length - 1; index > 0; index -= 1) {
    const random = Math.floor(Math.random() * (index + 1));
    [array[index], array[random]] = [array[random], array[index]];
  }
  return array;
}

document.addEventListener('DOMContentLoaded', init);
