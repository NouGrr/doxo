/* Doxo — PDF editing happens entirely on this device. */
'use strict';
const $ = id => document.getElementById(id);
const state = { sources: [], pages: [], current: 0, tool: 'select', selected: null, image: null, scale: 1, fit: true, dirty: false, name: 'Document.pdf', history: [], future: [], busy: false };
const imageCache = new Map();
let viewport, baseViewport, renderTask, renderGeneration = 0, thumbnailGeneration = 0, gesture = null, toastTimer, resizeTimer, textItems = [];
const titles = { edit: 'Modifiez le texte du PDF.', select: 'L’essentiel, à portée de main.', text: 'Ajoutez votre voix.', draw: 'Tracez vos idées.', highlight: 'L’essentiel en couleur.', rectangle: 'Donnez forme à vos idées.', image: 'Une image vaut mille mots.' };
const hints = { edit: 'Cliquez sur un bloc de texte encadré pour le modifier', select: 'Sélectionnez ou déplacez une annotation', text: 'Cliquez pour ajouter votre texte', draw: 'Faites glisser pour dessiner', highlight: 'Faites glisser pour surligner une zone', rectangle: 'Faites glisser pour tracer un rectangle', image: 'Cliquez pour placer votre image' };
const current = () => state.pages[state.current];
const clone = value => JSON.parse(JSON.stringify(value));
const snapshot = () => ({ pages: clone(state.pages), current: state.current });
function checkpoint() {
  state.history.push(snapshot());
  if (state.history.length > 35) state.history.shift();
  state.future = [];
}
function changed() { state.dirty = true; updateControls(); drawAnnotations(); }
function notify(message, error = false) {
  clearTimeout(toastTimer); $('toast').textContent = message; $('toast').classList.toggle('error', error); $('toast').hidden = false;
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, error ? 7000 : 3500);
}
async function runBusy(label, action) {
  if (state.busy) return;
  state.busy = true; $('busyText').textContent = label; $('busy').hidden = false;
  try { await action(); } catch (error) {
    console.error(error);
    const message = /password|encrypted/i.test(error.message) ? 'Ce PDF est protégé par un mot de passe. Ouvrez une copie déverrouillée.' : error.message || 'Une erreur est survenue. Essayez un autre fichier.';
    notify(message, true);
  } finally { state.busy = false; $('busy').hidden = true; }
}
function updateControls() {
  const hasDocument = state.pages.length > 0;
  $('undo').disabled = state.history.length === 0; $('redo').disabled = state.future.length === 0;
  ['export', 'addPage', 'fit', 'zoomIn', 'zoomOut'].forEach(id => {
    const button = $(id);
    if (button) button.disabled = !hasDocument;
  });
  document.querySelectorAll('.document-control').forEach(button => { button.disabled = !hasDocument; });
  document.querySelectorAll('[data-action="delete-page"]').forEach(button => {
    button.disabled = state.pages.length < 2;
    button.title = state.pages.length === 1 ? 'Le PDF doit conserver au moins une page.' : 'Supprimer la page sélectionnée';
  });
  document.querySelectorAll('.page-thumb').forEach(button => {
    const active = button.dataset.pageId === current()?.id;
    button.classList.toggle('active', active); button.setAttribute('aria-current', active ? 'page' : 'false');
  });
  $('moveUp').disabled = !hasDocument || state.current === 0;
  $('moveDown').disabled = !hasDocument || state.current === state.pages.length - 1;
  $('pageCount').textContent = state.pages.length;
  $('currentPage').textContent = hasDocument ? `${state.current + 1} / ${state.pages.length}` : '—';
  $('documentName').textContent = hasDocument ? state.name : 'Votre prochain document commence ici';
  $('saveState').textContent = state.dirty ? 'Modifications à exporter' : hasDocument ? 'Prêt à exporter · 100 % local' : 'Sans compte. Sans envoi.';
  $('canvasHint').textContent = hasDocument ? hints[state.tool] : 'Un espace pour vos idées';
  $('selectionPanel').hidden = !state.selected;
  $('welcome').hidden = hasDocument; $('pageFrame').hidden = !hasDocument;
}
function setTool(tool) {
  state.tool = tool;
  document.querySelectorAll('[data-tool]').forEach(button => { const active = button.dataset.tool === tool; button.classList.toggle('active', active); button.setAttribute('aria-pressed', active); });
  $('panelTitle').textContent = titles[tool];
  ['select', 'text', 'draw', 'image'].forEach(name => { $(`${name}Panel`).hidden = !(name === tool || name === 'text' && tool === 'edit' || name === 'draw' && ['highlight', 'rectangle'].includes(tool)); });
  $('textHelp').textContent = tool === 'edit' ? 'Cliquez sur un bloc encadré, modifiez son texte puis cliquez sur Appliquer. Le fond est repris automatiquement : ajustez-le au besoin. Les pages modifiées sont aplaties à l’export. Les scans nécessitent un OCR pour détecter leur texte.' : 'Cliquez sur la page pour ajouter votre texte.';
  $('applyText').hidden = tool !== 'edit';
  $('backgroundLabel').hidden = tool !== 'edit';
  $('colorPanel').hidden = !['edit', 'text', 'draw', 'highlight', 'rectangle'].includes(tool);
  $('drawingTitle').textContent = tool === 'highlight' ? 'Surlignage' : tool === 'rectangle' ? 'Rectangle' : 'Dessin libre';
  $('drawingHelp').textContent = tool === 'highlight' ? 'Tracez une zone pour la surligner en transparence.' : tool === 'rectangle' ? 'Tracez un rectangle pour encadrer un passage.' : 'Cliquez et faites glisser sur la page pour dessiner.';
  $('strokeSize').disabled = tool === 'highlight';
  $('annotationCanvas').style.cursor = tool === 'select' ? 'default' : ['edit', 'text'].includes(tool) ? 'text' : 'crosshair';
  if (tool === 'highlight' && !state.selected) $('color').value = '#f4ce4e';
  updateControls(); drawAnnotations();
}
async function confirmReplacement() {
  if (!state.dirty) return true;
  const dialog = $('confirmDialog'); dialog.showModal();
  return new Promise(resolve => { dialog.addEventListener('close', () => resolve(dialog.returnValue === 'confirm'), { once: true }); });
}
function pdfOptions(bytes) {
  const options = { data: bytes.slice(), isEvalSupported: false, cMapUrl: 'vendor/cmaps/', cMapPacked: true, standardFontDataUrl: 'vendor/standard_fonts/' };
  if (location.protocol === 'file:') {
    const readAsset = name => {
      const encoded = window.DOXO_PDF_ASSETS[name];
      if (!encoded) throw new Error(`Ressource PDF introuvable : ${name}`);
      return Uint8Array.from(atob(encoded), char => char.charCodeAt(0));
    };
    options.useWorkerFetch = false;
    options.CMapReaderFactory = class { async fetch({ name }) { return { cMapData: readAsset(`cmaps/${name}.bcmap`), compressionType: 1 }; } };
    options.StandardFontDataFactory = class { async fetch({ filename }) { return readAsset(`standard_fonts/${filename}`); } };
  }
  return options;
}
async function loadBytes(bytes, name, merge = false) {
  if (!window.pdfjsLib || !window.PDFLib) throw new Error('Les bibliothèques PDF sont indisponibles. Rechargez la page.');
  // Validate both reading and writing before replacing the current document.
  await PDFLib.PDFDocument.load(bytes.slice());
  const renderer = await pdfjsLib.getDocument(pdfOptions(bytes)).promise;
  const source = { bytes, renderer };
  if (merge) checkpoint();
  else { state.sources = []; state.pages = []; state.history = []; state.future = []; state.name = name; state.current = 0; state.dirty = false; }
  const sourceId = state.sources.push(source) - 1;
  const start = state.pages.length;
  for (let index = 0; index < renderer.numPages; index++) state.pages.push({ id: crypto.randomUUID(), sourceId, index, rotation: 0, annotations: [] });
  if (merge) { state.current = start; state.dirty = true; }
  state.selected = null; state.fit = true; updateControls();
  await renderPage(); renderThumbnails();
}
async function openFile(file, merge = false) {
  if (!file) return;
  if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') return notify('Choisissez un fichier au format PDF.', true);
  if (!merge && !(await confirmReplacement())) return;
  await runBusy(merge ? 'Assemblage des documents…' : 'Ouverture du document…', async () => {
    await loadBytes(new Uint8Array(await file.arrayBuffer()), file.name, merge);
    notify(merge ? 'Les pages ont été ajoutées.' : 'Votre PDF est prêt à être modifié.');
  });
}
async function getPage(model = current()) { return state.sources[model.sourceId].renderer.getPage(model.index + 1); }
async function renderPage() {
  if (!current()) return;
  const generation = ++renderGeneration;
  textItems = [];
  if (renderTask) { renderTask.cancel(); try { await renderTask.promise; } catch (_) { /* cancelled rendering */ } }
  const page = await getPage();
  if (generation !== renderGeneration) return;
  baseViewport = page.getViewport({ scale: 1, rotation: 0 });
  const rotation = (page.rotate + current().rotation + 360) % 360;
  const unscaled = page.getViewport({ scale: 1, rotation });
  if (state.fit) state.scale = Math.min(1.5, Math.max(.15, Math.min(($('stage').clientWidth - 58) / unscaled.width, ($('stage').clientHeight - 58) / unscaled.height)));
  viewport = page.getViewport({ scale: state.scale, rotation });
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  for (const id of ['pdfCanvas', 'annotationCanvas']) {
    const canvas = $(id); canvas.width = Math.ceil(viewport.width * ratio); canvas.height = Math.ceil(viewport.height * ratio);
    canvas.style.width = `${viewport.width}px`; canvas.style.height = `${viewport.height}px`;
  }
  $('pageFrame').style.width = `${viewport.width}px`; $('pageFrame').style.height = `${viewport.height}px`;
  $('zoomValue').textContent = `${Math.round(state.scale * 100)} %`;
  $('documentInfo').textContent = `Page ${state.current + 1} sur ${state.pages.length} · ${Math.round(baseViewport.width)} × ${Math.round(baseViewport.height)} pt`;
  renderTask = page.render({ canvasContext: $('pdfCanvas').getContext('2d'), viewport, transform: [ratio, 0, 0, ratio, 0, 0] });
  try { await renderTask.promise; } catch (error) { if (error.name !== 'RenderingCancelledException') throw error; }
  if (generation !== renderGeneration) return;
  const content = await page.getTextContent();
  if (generation !== renderGeneration) return;
  textItems = content.items.filter(item => item.str?.trim()).map((item, index) => {
    const transform = pdfjsLib.Util.transform(baseViewport.transform, item.transform);
    const size = Math.hypot(transform[2], transform[3]);
    const style = content.styles[item.fontName] || {};
    const ascent = style.ascent || .8;
    return { sourceIndex: index, text: item.str, x: transform[4], y: transform[5] - size * ascent, w: item.width * baseViewport.scale, h: size * 1.15, size, bold: /bold|black/i.test(style.fontFamily || '') || /bold/i.test(item.fontName), angle: Math.atan2(transform[1], transform[0]) };
  }).filter(item => item.w > 0 && item.size > 0 && Math.abs(item.angle) < .02);
  drawAnnotations(); updateControls();
}
async function renderThumbnails() {
  const generation = ++thumbnailGeneration;
  $('pageList').replaceChildren();
  for (let index = 0; index < state.pages.length; index++) {
    if (generation !== thumbnailGeneration) return;
    const model = state.pages[index];
    const wrapper = document.createElement('div'); wrapper.className = 'page-item';
    const button = document.createElement('button'); button.className = `page-thumb${index === state.current ? ' active' : ''}`;
    button.dataset.pageId = model.id;
    button.setAttribute('aria-label', `Afficher la page ${index + 1}`); button.setAttribute('aria-current', index === state.current ? 'page' : 'false');
    const paper = document.createElement('span'); paper.className = 'thumb-paper';
    const canvas = document.createElement('canvas'); paper.append(canvas);
    const label = document.createElement('span'); label.textContent = `${String(index + 1).padStart(2, '0')}${model.annotations.length ? ' · modifiée' : ''}`;
    button.append(paper, label);
    button.addEventListener('click', () => {
      const target = state.pages.findIndex(page => page.id === model.id);
      if (target < 0 || state.busy) return;
      state.current = target; state.selected = null; state.fit = true; updateControls();
      renderPage().catch(error => notify(error.message, true));
    });
    const remove = document.createElement('button'); remove.className = 'delete-thumb'; remove.dataset.pageId = model.id;
    remove.setAttribute('aria-label', `Supprimer la page ${index + 1}`);
    remove.disabled = state.pages.length < 2;
    remove.title = remove.disabled ? 'Le PDF doit conserver au moins une page.' : `Supprimer la page ${index + 1}`;
    remove.innerHTML = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/></svg>';
    remove.addEventListener('click', () => deletePdfPage(model.id));
    wrapper.append(button, remove); $('pageList').append(wrapper);
    try {
      const page = await getPage(model);
      if (generation !== thumbnailGeneration) return;
      const initial = page.getViewport({ scale: 1, rotation: (page.rotate + model.rotation + 360) % 360 });
      const view = page.getViewport({ scale: 130 / Math.max(initial.width, initial.height), rotation: initial.rotation });
      canvas.width = Math.ceil(view.width); canvas.height = Math.ceil(view.height);
      await page.render({ canvasContext: canvas.getContext('2d'), viewport: view }).promise;
      if (generation !== thumbnailGeneration) return;
      const base = page.getViewport({ scale: 1, rotation: 0 });
      const matrix = new DOMMatrix(view.transform).multiply(new DOMMatrix(base.transform).inverse());
      const ctx = canvas.getContext('2d'); ctx.setTransform(matrix);
      model.annotations.forEach(item => paintAnnotation(ctx, item));
    } catch (error) { console.error(error); }
  }
}
function annotationBounds(annotation) {
  if (annotation.type === 'draw') {
    const xs = annotation.points.map(p => p.x), ys = annotation.points.map(p => p.y);
    return { x: Math.min(...xs) - annotation.size, y: Math.min(...ys) - annotation.size, w: Math.max(...xs) - Math.min(...xs) + annotation.size * 2, h: Math.max(...ys) - Math.min(...ys) + annotation.size * 2 };
  }
  if (['text', 'replacement'].includes(annotation.type)) {
    const ctx = $('annotationCanvas').getContext('2d'); ctx.save(); ctx.font = `${annotation.bold ? '700' : '400'} ${annotation.size}px Arial`;
    const lines = annotation.text.split('\n'); const w = Math.max(...lines.map(line => ctx.measureText(line).width), 10); ctx.restore();
    return { x: annotation.x, y: annotation.y, w, h: lines.length * annotation.size * 1.25 };
  }
  return { x: annotation.x, y: annotation.y, w: annotation.w, h: annotation.h };
}
function paintAnnotation(ctx, item) {
  ctx.save(); ctx.strokeStyle = item.color || '#000'; ctx.fillStyle = item.color || '#000'; ctx.lineWidth = item.size || 2; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  if (item.type === 'replacement') {
    ctx.fillStyle = item.background; ctx.fillRect(item.mask.x - 1, item.mask.y - 2, item.mask.w + 2, item.mask.h + 4); ctx.fillStyle = item.color;
  }
  if (['text', 'replacement'].includes(item.type)) {
    ctx.font = `${item.bold ? '700' : '400'} ${item.size}px Arial`; ctx.textBaseline = 'top';
    item.text.split('\n').forEach((line, index) => ctx.fillText(line, item.x, item.y + index * item.size * 1.25));
  } else if (item.type === 'draw') {
    ctx.beginPath(); item.points.forEach((point, index) => index ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y));
    if (item.points.length === 1) { ctx.lineTo(item.points[0].x + .1, item.points[0].y); } ctx.stroke();
  } else if (item.type === 'highlight') { ctx.globalAlpha = .3; ctx.fillRect(item.x, item.y, item.w, item.h); }
  else if (item.type === 'rectangle') ctx.strokeRect(item.x, item.y, item.w, item.h);
  else if (item.type === 'image') { const img = imageCache.get(item.data); if (img?.complete) ctx.drawImage(img, item.x, item.y, item.w, item.h); }
  ctx.restore();
}
function displayMatrix() { return new DOMMatrix(viewport.transform).multiply(new DOMMatrix(baseViewport.transform).inverse()); }
function drawAnnotations() {
  if (!current() || !viewport || !baseViewport) return;
  const canvas = $('annotationCanvas'), ctx = canvas.getContext('2d'); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, canvas.width, canvas.height);
  const ratio = Math.min(window.devicePixelRatio || 1, 2); const matrix = new DOMMatrix().scale(ratio).multiply(displayMatrix());
  ctx.setTransform(matrix); current().annotations.forEach(item => paintAnnotation(ctx, item));
  if (state.tool === 'edit') {
    ctx.save(); ctx.lineWidth = .7 / state.scale; ctx.strokeStyle = '#9c64e899'; ctx.setLineDash([3 / state.scale, 3 / state.scale]);
    textItems.forEach(item => { if (!current().annotations.some(a => a.type === 'replacement' && a.sourceIndex === item.sourceIndex)) ctx.strokeRect(item.x - 2, item.y - 2, item.w + 4, item.h + 4); });
    ctx.restore();
  }
  if (state.selected) {
    const selected = current().annotations.find(item => item.id === state.selected);
    if (selected) { const box = annotationBounds(selected); ctx.save(); ctx.lineWidth = 1.5 / state.scale; ctx.setLineDash([5 / state.scale, 4 / state.scale]); ctx.strokeStyle = '#8860d9'; ctx.strokeRect(box.x - 4, box.y - 4, box.w + 8, box.h + 8); ctx.restore(); }
  }
}
function pointerPosition(event) {
  const rect = $('annotationCanvas').getBoundingClientRect();
  return new DOMPoint((event.clientX - rect.left) * viewport.width / rect.width, (event.clientY - rect.top) * viewport.height / rect.height).matrixTransform(displayMatrix().inverse());
}
function containsPoint(box, point) { return point.x >= box.x - 3 && point.x <= box.x + box.w + 3 && point.y >= box.y - 3 && point.y <= box.y + box.h + 3; }
function sampleBackground(box) {
  const canvas = $('pdfCanvas'), ctx = canvas.getContext('2d');
  const point = new DOMPoint(box.x - 2, box.y - 2).matrixTransform(displayMatrix());
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const pixel = ctx.getImageData(Math.max(0, Math.min(canvas.width - 1, Math.round(point.x * ratio))), Math.max(0, Math.min(canvas.height - 1, Math.round(point.y * ratio))), 1, 1).data;
  return '#' + [...pixel].slice(0, 3).map(value => value.toString(16).padStart(2, '0')).join('');
}
function selectAnnotation(item) {
  state.selected = item?.id || null;
  if (item) {
    if (item.color) $('color').value = item.color;
    if (['text', 'replacement'].includes(item.type)) { $('textInput').value = item.text; $('fontSize').value = item.size; $('fontSizeValue').textContent = `${Math.round(item.size)} pt`; $('bold').checked = item.bold; }
    if (item.type === 'replacement') $('backgroundColor').value = item.background;
  }
  updateControls(); drawAnnotations();
}
function onPointerDown(event) {
  if (!current() || state.busy || event.button !== 0) return;
  event.preventDefault(); $('annotationCanvas').focus({ preventScroll: true });
  const point = pointerPosition(event), model = current();
  if (state.tool === 'edit') {
    const existing = [...model.annotations].reverse().find(item => ['text', 'replacement'].includes(item.type) && containsPoint(annotationBounds(item), point));
    if (existing) { selectAnnotation(existing); $('textInput').focus(); return; }
    const original = textItems.find(item => containsPoint(item, point));
    if (!original) return notify(textItems.length ? 'Cliquez sur un bloc de texte encadré.' : 'Aucun texte détecté : utilisez Texte pour annoter cette page scannée.');
    const prior = model.annotations.find(item => item.type === 'replacement' && item.sourceIndex === original.sourceIndex);
    if (prior) { selectAnnotation(prior); $('textInput').focus(); return; }
    checkpoint();
    const item = { ...clone(original), id: crypto.randomUUID(), type: 'replacement', mask: { x: original.x, y: original.y, w: original.w, h: original.h }, color: '#171b29', background: sampleBackground(original) };
    model.annotations.push(item); selectAnnotation(item); changed(); $('textInput').focus(); return;
  } else if (state.tool === 'select') {
    const item = [...model.annotations].reverse().find(annotation => { const b = annotationBounds(annotation); return point.x >= b.x - 6 && point.x <= b.x + b.w + 6 && point.y >= b.y - 6 && point.y <= b.y + b.h + 6; });
    selectAnnotation(item);
    if (item) gesture = { type: 'move', start: point, original: clone(item), item, saved: false };
  } else if (state.tool === 'text') {
    const text = $('textInput').value.trim(); if (!text) return notify('Saisissez d’abord votre texte dans le panneau.');
    checkpoint(); const item = { id: crypto.randomUUID(), type: 'text', text, x: point.x, y: point.y, size: +$('fontSize').value, bold: $('bold').checked, color: $('color').value };
    model.annotations.push(item); selectAnnotation(item); changed(); renderThumbnails();
  } else if (state.tool === 'image') {
    if (!state.image) { $('imageInput').click(); return; }
    checkpoint(); const w = +$('imageWidth').value; const item = { id: crypto.randomUUID(), type: 'image', x: point.x, y: point.y, w, h: w * state.image.height / state.image.width, data: state.image.data };
    model.annotations.push(item); selectAnnotation(item); changed(); renderThumbnails();
  } else {
    checkpoint(); const item = { id: crypto.randomUUID(), type: state.tool, x: point.x, y: point.y, w: 0, h: 0, size: +$('strokeSize').value, color: $('color').value, points: [{ x: point.x, y: point.y }] };
    model.annotations.push(item); state.selected = null; gesture = { type: 'create', start: point, item }; changed();
  }
  if (gesture) $('annotationCanvas').setPointerCapture(event.pointerId);
}
function onPointerMove(event) {
  if (!gesture) return;
  const point = pointerPosition(event), dx = point.x - gesture.start.x, dy = point.y - gesture.start.y;
  if (gesture.type === 'move') {
    if (!gesture.saved) { if (Math.abs(dx) + Math.abs(dy) < 1) return; checkpoint(); gesture.saved = true; }
    const item = gesture.item, original = gesture.original;
    item.x = original.x + dx; item.y = original.y + dy;
    if (item.type === 'draw') item.points = original.points.map(p => ({ x: p.x + dx, y: p.y + dy }));
  } else if (gesture.item.type === 'draw') gesture.item.points.push({ x: point.x, y: point.y });
  else { gesture.item.x = Math.min(point.x, gesture.start.x); gesture.item.y = Math.min(point.y, gesture.start.y); gesture.item.w = Math.abs(dx); gesture.item.h = Math.abs(dy); }
  changed();
}
function endGesture(event, cancel = false) {
  if (!gesture) return;
  if (cancel) {
    if (gesture.type === 'create' || gesture.saved) { const old = state.history.pop(); if (old) state.pages = old.pages; }
  } else if (gesture.type === 'create' && gesture.item.type !== 'draw' && (gesture.item.w < 2 || gesture.item.h < 2)) { current().annotations = current().annotations.filter(item => item.id !== gesture.item.id); state.history.pop(); }
  gesture = null;
  if ($('annotationCanvas').hasPointerCapture(event.pointerId)) $('annotationCanvas').releasePointerCapture(event.pointerId);
  updateControls(); drawAnnotations(); renderThumbnails();
}
function deleteSelected() {
  if (!state.selected || !current()) return;
  checkpoint(); current().annotations = current().annotations.filter(item => item.id !== state.selected); state.selected = null; changed(); renderThumbnails();
}
function updateSelected(property, value, types) {
  const selected = current()?.annotations.find(item => item.id === state.selected);
  if (!selected || !types.includes(selected.type) || selected[property] === value) return;
  checkpoint(); selected[property] = value; changed();
}
async function historyMove(redo = false) {
  if (state.busy || gesture) return;
  const from = redo ? state.future : state.history, to = redo ? state.history : state.future;
  if (!from.length) return;
  to.push(snapshot()); const old = from.pop(); state.pages = old.pages; state.current = old.current; state.selected = null; state.dirty = true; updateControls(); await renderPage(); renderThumbnails();
}
async function rotate(degrees) { if (!current()) return; checkpoint(); current().rotation = (current().rotation + degrees + 360) % 360; state.selected = null; changed(); await renderPage(); renderThumbnails(); }
async function movePage(direction) {
  const target = state.current + direction; if (target < 0 || target >= state.pages.length) return;
  checkpoint(); [state.pages[state.current], state.pages[target]] = [state.pages[target], state.pages[state.current]]; state.current = target; changed(); await renderPage(); renderThumbnails();
}
async function deletePdfPage(pageId) {
  if (state.busy) return;
  if (state.pages.length < 2) return notify('Le PDF doit conserver au moins une page.');
  const index = state.pages.findIndex(page => page.id === pageId);
  if (index < 0) return;
  await runBusy('Suppression de la page…', async () => {
    const selectedId = current()?.id;
    checkpoint(); state.pages.splice(index, 1);
    const selectedIndex = state.pages.findIndex(page => page.id === selectedId);
    state.current = selectedIndex >= 0 ? selectedIndex : Math.min(index, state.pages.length - 1);
    state.selected = null; state.fit = true; changed();
    await renderPage(); renderThumbnails();
    notify(`Page ${index + 1} supprimée. Annulez avec ↶ ou exportez pour enregistrer le PDF.`);
  });
}
async function addBlankPage() {
  if (!current()) return;
  await runBusy('Ajout d’une page vierge…', async () => {
    const page = await getPage();
    const size = page.getViewport({ scale: 1, rotation: (page.rotate + current().rotation + 360) % 360 });
    const doc = await PDFLib.PDFDocument.create(); doc.addPage([size.width, size.height]);
    const bytes = await doc.save();
    const renderer = await pdfjsLib.getDocument(pdfOptions(bytes)).promise;
    checkpoint();
    const sourceId = state.sources.push({ bytes, renderer }) - 1;
    state.pages.splice(state.current + 1, 0, { id: crypto.randomUUID(), sourceId, index: 0, rotation: 0, annotations: [] });
    state.current++; state.selected = null; state.fit = true; changed();
    await renderPage(); renderThumbnails(); notify('Page vierge ajoutée après la page sélectionnée.');
  });
}
async function hydrateImages() {
  for (const model of state.pages) for (const annotation of model.annotations) if (annotation.type === 'image' && !imageCache.has(annotation.data)) await cacheImage(annotation.data);
}
function cacheImage(data) { return new Promise((resolve, reject) => { const img = new Image(); img.onload = () => { imageCache.set(data, img); resolve(img); }; img.onerror = () => reject(new Error('Cette image ne peut pas être lue.')); img.src = data; }); }
async function exportDocument() {
  if (!current()) return;
  await runBusy('Préparation de votre PDF…', async () => {
    await hydrateImages();
    const output = await PDFLib.PDFDocument.create(); const loaded = new Map();
    for (const model of state.pages) {
      if (model.annotations.some(item => item.type === 'replacement')) {
        // Rebuild edited pages as an image: the replaced source text is not retained underneath.
        const original = await getPage(model), base = original.getViewport({ scale: 1, rotation: 0 });
        const quality = Math.min(2, 4096 / Math.max(base.width, base.height));
        const canvas = document.createElement('canvas'); canvas.width = Math.ceil(base.width * quality); canvas.height = Math.ceil(base.height * quality);
        const ctx = canvas.getContext('2d');
        await original.render({ canvasContext: ctx, viewport: original.getViewport({ scale: quality, rotation: 0 }) }).promise;
        ctx.setTransform(quality, 0, 0, quality, 0, 0); model.annotations.forEach(item => paintAnnotation(ctx, item));
        const png = await output.embedPng(canvas.toDataURL('image/png'));
        const rebuilt = output.addPage([base.width, base.height]); rebuilt.drawImage(png, { x: 0, y: 0, width: base.width, height: base.height });
        rebuilt.setRotation(PDFLib.degrees((original.rotate + model.rotation + 360) % 360));
        canvas.width = 0; canvas.height = 0; continue;
      }
      if (!loaded.has(model.sourceId)) loaded.set(model.sourceId, await PDFLib.PDFDocument.load(state.sources[model.sourceId].bytes.slice()));
      const source = loaded.get(model.sourceId); const [copied] = await output.copyPages(source, [model.index]); output.addPage(copied);
      if (model.annotations.length) {
        const page = await getPage(model), base = page.getViewport({ scale: 1, rotation: 0 });
        const canvas = document.createElement('canvas'); const quality = Math.min(2, 4096 / Math.max(base.width, base.height));
        canvas.width = Math.ceil(base.width * quality); canvas.height = Math.ceil(base.height * quality);
        const ctx = canvas.getContext('2d'); ctx.scale(quality, quality); model.annotations.forEach(item => paintAnnotation(ctx, item));
        const png = await output.embedPng(canvas.toDataURL('image/png'));
        const box = copied.getCropBox(); copied.drawImage(png, { x: box.x, y: box.y, width: box.width, height: box.height });
        canvas.width = 0; canvas.height = 0;
      }
      copied.setRotation(PDFLib.degrees((copied.getRotation().angle + model.rotation + 360) % 360));
    }
    output.setProducer('Doxo — L’atelier PDF');
    const data = await output.save(); const blob = new Blob([data], { type: 'application/pdf' });
    const link = document.createElement('a'); const url = URL.createObjectURL(blob); link.href = url; link.download = `${state.name.replace(/\.pdf$/i, '')}-doxo.pdf`; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000);
    state.dirty = false; updateControls(); notify('Votre PDF modifié a été téléchargé.');
  });
}
async function createDemo() {
  if (!(await confirmReplacement())) return;
  await runBusy('Un peu d’inspiration…', async () => {
    const doc = await PDFLib.PDFDocument.create(); const font = await doc.embedFont(PDFLib.StandardFonts.Helvetica), bold = await doc.embedFont(PDFLib.StandardFonts.HelveticaBold);
    const rgb = PDFLib.rgb; const ink = rgb(.09, .12, .2), muted = rgb(.42, .46, .55), violet = rgb(.57, .36, .85);
    for (let i = 0; i < 2; i++) {
      const page = doc.addPage([595.28, 841.89]);
      page.drawRectangle({ x: 0, y: 0, width: 595.28, height: 841.89, color: rgb(.99, .985, .975) });
      page.drawText('DOXO / CARNET DE NOTES', { x: 52, y: 782, size: 10, font: bold, color: violet });
      page.drawLine({ start: { x: 52, y: 760 }, end: { x: 543, y: 760 }, thickness: 1, color: rgb(.85, .84, .9) });
      page.drawText(i ? 'Et maintenant,' : 'Les bonnes idées', { x: 52, y: 687, size: 38, font: bold, color: ink });
      page.drawText(i ? 'à vous de jouer.' : 'méritent une place.', { x: 52, y: 638, size: 38, font: bold, color: i ? ink : violet });
      page.drawText(i ? 'Faites de cette page votre terrain de jeu.' : 'Un document pour imaginer, annoter et avancer.', { x: 53, y: 593, size: 13, font, color: muted });
      const sections = i ? [['01', 'Ajoutez une note', 'Choisissez Texte, écrivez, puis cliquez sur la page.'], ['02', 'Mettez vos idées en lumière', 'Surlignez un passage ou dessinez à main levée.'], ['03', 'Emportez votre document', 'Exportez votre PDF pour conserver vos modifications.']] : [['01', 'Voir plus grand', 'Chaque projet commence par une idée toute simple.'], ['02', 'Faire de la place', 'Gardez l’essentiel. Ajoutez votre propre perspective.'], ['03', 'Passer à la suite', 'Un petit changement peut ouvrir de nouvelles possibilités.']];
      sections.forEach(([number, title, description], index) => {
        const y = 485 - index * 100;
        page.drawText(number, { x: 54, y, size: 11, font: bold, color: violet });
        page.drawText(title, { x: 91, y: y - 1, size: 16, font: bold, color: ink });
        page.drawText(description, { x: 91, y: y - 28, size: 11, font, color: muted });
        page.drawLine({ start: { x: 91, y: y - 51 }, end: { x: 540, y: y - 51 }, thickness: .6, color: rgb(.87, .86, .9) });
      });
      page.drawText('De la famille Pixo. Pensé pour vos documents.', { x: 53, y: 55, size: 9, font, color: muted });
      page.drawText(`0${i + 1}`, { x: 523, y: 55, size: 10, font: bold, color: violet });
    }
    await loadBytes(await doc.save(), 'Les bonnes idées.pdf');
    notify('À vous de jouer : choisissez un outil à gauche.');
  });
}
function bindEvents() {
  ['open', 'choose'].forEach(id => { $(id).onclick = () => $('fileInput').click(); });
  $('fileInput').onchange = async event => { await openFile(event.target.files[0]); event.target.value = ''; };
  $('addPage').onclick = addBlankPage;
  $('demo').onclick = createDemo; $('export').onclick = exportDocument;
  $('undo').onclick = () => historyMove(); $('redo').onclick = () => historyMove(true);
  document.querySelectorAll('[data-tool]').forEach(button => { button.onclick = () => setTool(button.dataset.tool); });
  $('fit').onclick = () => { state.fit = true; renderPage().catch(error => notify(error.message, true)); };
  function zoom(multiplier) { state.fit = false; state.scale = Math.max(.15, Math.min(3, state.scale * multiplier)); renderPage().catch(error => notify(error.message, true)); }
  $('zoomIn').onclick = () => zoom(1.2); $('zoomOut').onclick = () => zoom(1 / 1.2);
  $('rotateLeft').onclick = () => rotate(-90); $('rotateRight').onclick = () => rotate(90);
  $('moveUp').onclick = () => movePage(-1); $('moveDown').onclick = () => movePage(1);
  document.querySelectorAll('[data-action="delete-page"]').forEach(button => {
    button.onclick = () => deletePdfPage(current()?.id);
  });
  $('deleteAnnotation').onclick = deleteSelected;
  $('annotationCanvas').addEventListener('pointerdown', onPointerDown);
  $('annotationCanvas').addEventListener('pointermove', onPointerMove);
  $('annotationCanvas').addEventListener('pointerup', event => endGesture(event));
  $('annotationCanvas').addEventListener('pointercancel', event => endGesture(event, true));
  function applyText() { updateSelected('text', $('textInput').value, ['text', 'replacement']); renderThumbnails(); }
  $('textInput').addEventListener('change', applyText);
  $('applyText').onclick = applyText;
  $('backgroundColor').onchange = () => updateSelected('background', $('backgroundColor').value, ['replacement']);
  [['fontSize', 'fontSizeValue'], ['strokeSize', 'strokeSizeValue'], ['imageWidth', 'imageWidthValue']].forEach(([input, output]) => {
    $(input).oninput = () => { $(output).textContent = `${$(input).value} pt`; };
  });
  $('fontSize').onchange = () => updateSelected('size', +$('fontSize').value, ['text', 'replacement']);
  $('strokeSize').onchange = () => updateSelected('size', +$('strokeSize').value, ['draw', 'rectangle']);
  $('bold').onchange = () => updateSelected('bold', $('bold').checked, ['text', 'replacement']);
  $('color').onchange = () => updateSelected('color', $('color').value, ['text', 'replacement', 'draw', 'rectangle', 'highlight']);
  document.querySelectorAll('[data-color]').forEach(button => { button.onclick = () => { $('color').value = button.dataset.color; updateSelected('color', button.dataset.color, ['text', 'replacement', 'draw', 'rectangle', 'highlight']); }; });
  $('chooseImage').onclick = () => $('imageInput').click();
  $('imageInput').onchange = async event => {
    const file = event.target.files[0]; if (!file) return;
    if (!['image/png', 'image/jpeg'].includes(file.type)) { notify('Choisissez une image PNG ou JPEG.', true); event.target.value = ''; return; }
    await runBusy('Ouverture de l’image…', async () => {
      const data = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file); });
      const img = await cacheImage(data); state.image = { data, width: img.width, height: img.height }; $('imageName').textContent = file.name; setTool('image'); notify('Cliquez sur la page pour placer votre image.');
    }); event.target.value = '';
  };
  const stage = $('stage');
  window.addEventListener('dragover', event => { if (event.dataTransfer.types.includes('Files')) event.preventDefault(); });
  window.addEventListener('drop', event => { if (event.dataTransfer.files.length) event.preventDefault(); });
  stage.addEventListener('dragover', event => { event.preventDefault(); stage.classList.add('dragover'); });
  stage.addEventListener('dragleave', event => { if (!stage.contains(event.relatedTarget)) stage.classList.remove('dragover'); });
  stage.addEventListener('drop', event => { event.preventDefault(); stage.classList.remove('dragover'); if (!state.busy) openFile(event.dataTransfer.files[0]); });
  document.addEventListener('keydown', event => {
    if (event.target.matches('input,textarea') || $('confirmDialog').open || state.busy) return;
    const modifier = event.metaKey || event.ctrlKey;
    if (modifier && event.key.toLowerCase() === 'z') { event.preventDefault(); historyMove(event.shiftKey); }
    else if (modifier && event.key.toLowerCase() === 's') { event.preventDefault(); exportDocument(); }
    else if (['Backspace', 'Delete'].includes(event.key) && state.selected) { event.preventDefault(); deleteSelected(); }
    else if (event.key === 'Escape') selectAnnotation(null);
    else if (!modifier) { const keyTools = { e: 'edit', v: 'select', t: 'text', d: 'draw', h: 'highlight', r: 'rectangle' }; if (keyTools[event.key.toLowerCase()]) setTool(keyTools[event.key.toLowerCase()]); }
  });
  window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { if (current() && state.fit) renderPage().catch(error => notify(error.message, true)); }, 180); });
  window.addEventListener('beforeunload', event => { if (state.dirty) { event.preventDefault(); event.returnValue = ''; } });
}
if (window.pdfjsLib) pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';
bindEvents(); updateControls();
