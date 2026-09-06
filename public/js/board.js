import { db } from "./firebase.js";
import {
  doc,
  getDoc,
  deleteDoc,
  updateDoc,
  addDoc,
  collection,
  onSnapshot,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

const params = new URLSearchParams(window.location.search);
const boardId = params.get("id");

if (!boardId) {
  window.location.href = "index.html";
}

const boardTitleEl = document.getElementById("boardTitle");
const boardCanvas = document.getElementById("boardCanvas");
const canvasSpacer = document.querySelector(".board-canvas-inner-spacer");
const addStickyBtn = document.getElementById("addStickyBtn");
const addUnitBtn = document.getElementById("addUnitBtn");
const captureBtn = document.getElementById("captureBtn");

let schoolName = "";
let draggingNoteId = null; // 드래그 중인 노트는 원격 위치 업데이트로 덮어쓰지 않는다
let editingNoteId = null; // 편집 중인 노트는 원격 텍스트 업데이트로 덮어쓰지 않는다
let resizingNoteId = null; // 크기 조정 중인 노트는 원격 너비 업데이트로 덮어쓰지 않는다
const noteElements = new Map(); // noteId -> element
const textDebounceTimers = new Map();

// ---------- 보드 정보 로드 ----------
async function loadBoard() {
  const snap = await getDoc(doc(db, "boards", boardId));
  if (!snap.exists()) {
    alert("존재하지 않는 보드판입니다.");
    window.location.href = "index.html";
    return;
  }
  schoolName = snap.data().schoolName;
  boardTitleEl.textContent = `[${schoolName}]의 학교자율시간 활동내용`;
  document.title = `${schoolName} 보드판`;
}

// ---------- 캔버스 크기 (좌우 스크롤은 절대 생기지 않고, 필요한 만큼만 위아래로 늘어난다) ----------
function refreshCanvasHeight() {
  const viewportHeight = boardCanvas.clientHeight;
  let maxBottom = 0;
  noteElements.forEach((el) => {
    const bottom = (parseFloat(el.style.top) || 0) + el.offsetHeight;
    if (bottom > maxBottom) maxBottom = bottom;
  });
  canvasSpacer.style.height = `${Math.max(viewportHeight, maxBottom + 160)}px`;
}

function clampX(x, width) {
  const maxX = Math.max(0, boardCanvas.clientWidth - width);
  return Math.min(Math.max(0, x), maxX);
}

// ---------- 노트 추가 ----------
function nextSpawnPosition() {
  const assumedWidth = Math.min(340, boardCanvas.clientWidth * 0.6);
  const x = clampX(boardCanvas.scrollLeft + 60 + Math.random() * 60, assumedWidth);
  const y = boardCanvas.scrollTop + 90 + Math.random() * 60;
  return { x, y };
}

addStickyBtn.addEventListener("click", async () => {
  const { x, y } = nextSpawnPosition();
  await addDoc(collection(db, "boards", boardId, "notes"), {
    type: "sticky",
    text: "",
    x,
    y,
    createdAt: serverTimestamp(),
  });
});

addUnitBtn.addEventListener("click", async () => {
  const { x, y } = nextSpawnPosition();
  await addDoc(collection(db, "boards", boardId, "notes"), {
    type: "unit",
    text: "",
    x,
    y,
    createdAt: serverTimestamp(),
  });
});

// ---------- 사진 캡쳐 ----------
captureBtn.addEventListener("click", async () => {
  captureBtn.disabled = true;
  try {
    const canvasImg = await html2canvas(boardCanvas, {
      backgroundColor: "#f7f4ec",
      useCORS: true,
      scrollX: 0,
      scrollY: 0,
      width: boardCanvas.scrollWidth,
      height: boardCanvas.scrollHeight,
    });
    const link = document.createElement("a");
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    link.download = `${schoolName}_보드_${stamp}.png`;
    link.href = canvasImg.toDataURL("image/png");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  } catch (err) {
    console.error(err);
    alert("캡쳐 중 오류가 발생했습니다.");
  } finally {
    captureBtn.disabled = false;
  }
});

// ---------- 노트 렌더링 ----------
function createNoteElement(id, data) {
  const el = document.createElement("div");
  el.className = `note ${data.type}`;
  el.style.left = `${data.x}px`;
  el.style.top = `${data.y}px`;
  if (data.width) el.style.width = `${data.width}px`;
  el.dataset.id = id;

  const text = document.createElement("div");
  text.className = "note-text";
  text.contentEditable = "true";
  text.textContent = data.text || "";

  const delBtn = document.createElement("button");
  delBtn.className = "note-delete";
  delBtn.textContent = "🗑";
  delBtn.title = "삭제";
  delBtn.addEventListener("pointerdown", (e) => e.stopPropagation());
  delBtn.addEventListener("click", async (e) => {
    e.stopPropagation();
    await deleteDoc(doc(db, "boards", boardId, "notes", id));
  });

  const resizeHandle = document.createElement("div");
  resizeHandle.className = "resize-handle";
  resizeHandle.title = "드래그해서 폭 조정";

  el.appendChild(text);
  el.appendChild(delBtn);
  el.appendChild(resizeHandle);
  attachDragHandlers(el, id);
  attachTextHandlers(text, id);
  attachResizeHandlers(el, resizeHandle, id);

  boardCanvas.appendChild(el);
  noteElements.set(id, el);
  refreshCanvasHeight();
  return el;
}

function updateNoteElement(el, id, data) {
  if (draggingNoteId !== id) {
    el.style.left = `${data.x}px`;
    el.style.top = `${data.y}px`;
  }
  if (resizingNoteId !== id && data.width) {
    el.style.width = `${data.width}px`;
  }
  const text = el.querySelector(".note-text");
  if (editingNoteId !== id && text.textContent !== (data.text || "")) {
    text.textContent = data.text || "";
  }
  refreshCanvasHeight();
}

// ---------- 드래그 ----------
function attachDragHandlers(el, id) {
  let startX = 0;
  let startY = 0;
  let startLeft = 0;
  let startTop = 0;
  let moved = false;
  let pointerId = null;

  el.addEventListener("pointerdown", (e) => {
    if (e.target.closest(".note-delete") || e.target.closest(".resize-handle")) return;

    startX = e.clientX;
    startY = e.clientY;
    startLeft = parseFloat(el.style.left) || 0;
    startTop = parseFloat(el.style.top) || 0;
    moved = false;
    pointerId = e.pointerId;
  });

  el.addEventListener("pointermove", (e) => {
    if (pointerId === null || e.pointerId !== pointerId) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    if (!moved && Math.hypot(dx, dy) < 4) return;

    if (!moved) {
      moved = true;
      draggingNoteId = id;
      el.classList.add("dragging");
      el.setPointerCapture(pointerId);
      el.querySelector(".note-text").blur();
    }
    e.preventDefault();
    el.style.left = `${startLeft + dx}px`;
    el.style.top = `${startTop + dy}px`;
  });

  async function endDrag(e) {
    if (pointerId === null || (e && e.pointerId !== pointerId)) return;
    const wasMoved = moved;
    pointerId = null;
    moved = false;
    if (wasMoved) {
      el.classList.remove("dragging");
      // 보드 밖으로 놓으면 가장 가까운 보드 안쪽 위치로 되돌린다 (좌우는 항상 안쪽으로, 위쪽은 0 이상으로)
      const x = clampX(parseFloat(el.style.left) || 0, el.offsetWidth);
      const y = Math.max(0, parseFloat(el.style.top) || 0);
      el.style.left = `${x}px`;
      el.style.top = `${y}px`;
      draggingNoteId = null;
      refreshCanvasHeight();
      try {
        await updateDoc(doc(db, "boards", boardId, "notes", id), { x, y });
      } catch (err) {
        console.error(err);
      }
    }
  }

  el.addEventListener("pointerup", endDrag);
  el.addEventListener("pointercancel", endDrag);
}

// ---------- 크기 조정 (오른쪽 가장자리 손잡이로 폭만 조정, 세로 높이는 내용에 따라 자동) ----------
function attachResizeHandlers(el, handle, id) {
  let startX = 0;
  let startWidth = 0;
  let pointerId = null;

  handle.addEventListener("pointerdown", (e) => {
    e.stopPropagation();
    e.preventDefault();
    startX = e.clientX;
    startWidth = el.offsetWidth;
    pointerId = e.pointerId;
    resizingNoteId = id;
    handle.setPointerCapture(pointerId);
  });

  handle.addEventListener("pointermove", (e) => {
    if (pointerId === null || e.pointerId !== pointerId) return;
    const newWidth = Math.max(160, startWidth + (e.clientX - startX));
    el.style.width = `${newWidth}px`;
    refreshCanvasHeight();
  });

  async function endResize(e) {
    if (pointerId === null || (e && e.pointerId !== pointerId)) return;
    pointerId = null;
    resizingNoteId = null;
    const width = el.offsetWidth;
    let x = parseFloat(el.style.left) || 0;
    const clampedX = clampX(x, width);
    if (clampedX !== x) {
      x = clampedX;
      el.style.left = `${x}px`;
    }
    refreshCanvasHeight();
    try {
      await updateDoc(doc(db, "boards", boardId, "notes", id), { width, x });
    } catch (err) {
      console.error(err);
    }
  }

  handle.addEventListener("pointerup", endResize);
  handle.addEventListener("pointercancel", endResize);
}

// ---------- 텍스트 편집 ----------
function attachTextHandlers(textEl, id) {
  textEl.addEventListener("focus", () => {
    editingNoteId = id;
  });

  textEl.addEventListener("input", () => {
    clearTimeout(textDebounceTimers.get(id));
    const timer = setTimeout(() => {
      updateDoc(doc(db, "boards", boardId, "notes", id), {
        text: textEl.textContent,
      }).catch((err) => console.error(err));
    }, 500);
    textDebounceTimers.set(id, timer);
  });

  textEl.addEventListener("blur", () => {
    if (editingNoteId === id) editingNoteId = null;
    clearTimeout(textDebounceTimers.get(id));
    updateDoc(doc(db, "boards", boardId, "notes", id), {
      text: textEl.textContent,
    }).catch((err) => console.error(err));
  });
}

// ---------- 실시간 구독 ----------
function subscribeNotes() {
  onSnapshot(
    collection(db, "boards", boardId, "notes"),
    (snapshot) => {
      snapshot.docChanges().forEach((change) => {
        const id = change.doc.id;
        const data = change.doc.data();
        if (change.type === "added") {
          if (!noteElements.has(id)) createNoteElement(id, data);
          else updateNoteElement(noteElements.get(id), id, data);
        } else if (change.type === "modified") {
          const el = noteElements.get(id);
          if (el) updateNoteElement(el, id, data);
        } else if (change.type === "removed") {
          const el = noteElements.get(id);
          if (el) {
            el.remove();
            noteElements.delete(id);
            refreshCanvasHeight();
          }
        }
      });
    },
    (err) => console.error("notes listener error", err)
  );
}

window.addEventListener("resize", refreshCanvasHeight);

loadBoard();
subscribeNotes();
refreshCanvasHeight();
