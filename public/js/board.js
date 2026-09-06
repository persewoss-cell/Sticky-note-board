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
const homeBtn = document.getElementById("homeBtn");
const leaveConfirmModal = document.getElementById("leaveConfirmModal");
const cancelLeaveBtn = document.getElementById("cancelLeaveBtn");
const confirmLeaveBtn = document.getElementById("confirmLeaveBtn");

let schoolName = "";
let draggingNoteId = null; // 드래그 중인 노트는 원격 위치 업데이트로 덮어쓰지 않는다
let editingNoteId = null; // 편집 중인 노트는 원격 텍스트 업데이트로 덮어쓰지 않는다
let resizingNoteId = null; // 크기 조정 중인 노트는 원격 크기 업데이트로 덮어쓰지 않는다
const noteElements = new Map(); // noteId -> element
const textDebounceTimers = new Map();

// ---------- 홈으로 나가기 (설명 후 확인) ----------
homeBtn.addEventListener("click", () => {
  leaveConfirmModal.classList.remove("hidden");
});
cancelLeaveBtn.addEventListener("click", () => {
  leaveConfirmModal.classList.add("hidden");
});
confirmLeaveBtn.addEventListener("click", () => {
  window.location.href = "index.html";
});

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
  if (data.height) el.style.height = `${data.height}px`;
  el.dataset.id = id;

  const text = document.createElement("div");
  text.className = "note-text";
  text.contentEditable = "true";
  text.textContent = data.text || "";

  const moveHandle = document.createElement("button");
  moveHandle.className = "move-handle";
  moveHandle.textContent = "✥";
  moveHandle.title = "이동";

  const delBtn = document.createElement("button");
  delBtn.className = "note-delete";
  delBtn.textContent = "🗑";
  delBtn.title = "삭제";
  delBtn.addEventListener("pointerdown", (e) => e.stopPropagation());
  delBtn.addEventListener("click", async (e) => {
    e.stopPropagation();
    if (!window.confirm("이 메모를 삭제하시겠습니까?")) return;
    await deleteDoc(doc(db, "boards", boardId, "notes", id));
  });

  const resizeHandleH = document.createElement("div");
  resizeHandleH.className = "resize-handle-h";
  resizeHandleH.title = "드래그해서 폭 조정";

  const resizeHandleV = document.createElement("div");
  resizeHandleV.className = "resize-handle-v";
  resizeHandleV.title = "드래그해서 높이 조정";

  el.appendChild(text);
  el.appendChild(resizeHandleH);
  el.appendChild(resizeHandleV);
  el.appendChild(moveHandle);
  el.appendChild(delBtn);

  attachMoveHandlers(moveHandle, el, id);
  attachTextHandlers(text, id);
  attachResizeHandler(resizeHandleH, el, id, "x");
  attachResizeHandler(resizeHandleV, el, id, "y");

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
  if (resizingNoteId !== id) {
    if (data.width) el.style.width = `${data.width}px`;
    if (data.height) el.style.height = `${data.height}px`;
  }
  const text = el.querySelector(".note-text");
  if (editingNoteId !== id && text.textContent !== (data.text || "")) {
    text.textContent = data.text || "";
  }
  refreshCanvasHeight();
}

// ---------- 이동 (휴지통 옆 ✥ 손잡이를 잡았을 때만 드래그된다) ----------
function attachMoveHandlers(handle, el, id) {
  let startX = 0;
  let startY = 0;
  let startLeft = 0;
  let startTop = 0;
  let pointerId = null;

  handle.addEventListener("pointerdown", (e) => {
    e.stopPropagation();
    e.preventDefault();
    startX = e.clientX;
    startY = e.clientY;
    startLeft = parseFloat(el.style.left) || 0;
    startTop = parseFloat(el.style.top) || 0;
    pointerId = e.pointerId;
    draggingNoteId = id;
    el.classList.add("dragging");
    handle.setPointerCapture(pointerId);
  });

  handle.addEventListener("pointermove", (e) => {
    if (pointerId === null || e.pointerId !== pointerId) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    el.style.left = `${startLeft + dx}px`;
    el.style.top = `${startTop + dy}px`;
    refreshCanvasHeight();
  });

  async function endDrag(e) {
    if (pointerId === null || (e && e.pointerId !== pointerId)) return;
    pointerId = null;
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

  handle.addEventListener("pointerup", endDrag);
  handle.addEventListener("pointercancel", endDrag);
}

// ---------- 크기 조정 (오른쪽 가장자리 = 폭, 아래쪽 가장자리 = 높이. 대각선 동시 조정은 없음) ----------
function attachResizeHandler(handle, el, id, axis) {
  let start = 0;
  let startSize = 0;
  let pointerId = null;

  handle.addEventListener("pointerdown", (e) => {
    e.stopPropagation();
    e.preventDefault();
    start = axis === "x" ? e.clientX : e.clientY;
    startSize = axis === "x" ? el.offsetWidth : el.offsetHeight;
    pointerId = e.pointerId;
    resizingNoteId = id;
    handle.setPointerCapture(pointerId);
  });

  handle.addEventListener("pointermove", (e) => {
    if (pointerId === null || e.pointerId !== pointerId) return;
    const current = axis === "x" ? e.clientX : e.clientY;
    const newSize = Math.max(axis === "x" ? 160 : 40, startSize + (current - start));
    if (axis === "x") el.style.width = `${newSize}px`;
    else el.style.height = `${newSize}px`;
    refreshCanvasHeight();
  });

  async function endResize(e) {
    if (pointerId === null || (e && e.pointerId !== pointerId)) return;
    pointerId = null;
    resizingNoteId = null;
    const width = el.offsetWidth;
    const height = el.offsetHeight;
    let x = parseFloat(el.style.left) || 0;
    const clampedX = clampX(x, width);
    if (clampedX !== x) {
      x = clampedX;
      el.style.left = `${x}px`;
    }
    refreshCanvasHeight();
    try {
      await updateDoc(doc(db, "boards", boardId, "notes", id), { width, height, x });
    } catch (err) {
      console.error(err);
    }
  }

  handle.addEventListener("pointerup", endResize);
  handle.addEventListener("pointercancel", endResize);
}

// ---------- 텍스트 편집 (그 외 영역은 클릭하면 그냥 커서만 놓인다) ----------
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
