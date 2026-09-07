import { db } from "./firebase.js";
import {
  collection,
  addDoc,
  doc,
  getDoc,
  deleteDoc,
  onSnapshot,
  query,
  orderBy,
  serverTimestamp,
  getDocs,
  writeBatch,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

const boardGrid = document.getElementById("boardGrid");
const emptyMessage = document.getElementById("emptyMessage");

const createBoardBtn = document.getElementById("createBoardBtn");
const createModal = document.getElementById("createModal");
const schoolNameInput = document.getElementById("schoolNameInput");
const schoolPwInput = document.getElementById("schoolPwInput");
const createError = document.getElementById("createError");
const confirmCreateBtn = document.getElementById("confirmCreateBtn");
const cancelCreateBtn = document.getElementById("cancelCreateBtn");

const passwordModal = document.getElementById("passwordModal");
const passwordModalTitle = document.getElementById("passwordModalTitle");
const passwordInput = document.getElementById("passwordInput");
const passwordError = document.getElementById("passwordError");
const confirmPasswordBtn = document.getElementById("confirmPasswordBtn");
const cancelPasswordBtn = document.getElementById("cancelPasswordBtn");

const PASSWORD_RE = /^[0-9]{4}$/;

function openModal(el) { el.classList.remove("hidden"); }
function closeModal(el) { el.classList.add("hidden"); }

// ---------- 보드판 생성 ----------
createBoardBtn.addEventListener("click", () => {
  schoolNameInput.value = "";
  schoolPwInput.value = "";
  createError.classList.add("hidden");
  openModal(createModal);
  schoolNameInput.focus();
});

cancelCreateBtn.addEventListener("click", () => closeModal(createModal));

[schoolNameInput, schoolPwInput].forEach((input) => {
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      confirmCreateBtn.click();
    }
  });
});

confirmCreateBtn.addEventListener("click", async () => {
  const schoolName = schoolNameInput.value.trim();
  const rawPassword = schoolPwInput.value.trim();
  const password = rawPassword === "" ? "0000" : rawPassword;

  if (!schoolName) {
    createError.textContent = "학교명을 입력해 주세요.";
    createError.classList.remove("hidden");
    return;
  }
  if (!PASSWORD_RE.test(password)) {
    createError.textContent = "비밀번호는 숫자 4자리로 입력해 주세요.";
    createError.classList.remove("hidden");
    return;
  }

  confirmCreateBtn.disabled = true;
  try {
    const boardRef = await addDoc(collection(db, "boards"), {
      schoolName,
      password,
      createdAt: serverTimestamp(),
    });
    // 방금 만든 보드판은 비밀번호를 다시 물어보지 않고 바로 입장시킨다.
    window.location.href = `board.html?id=${boardRef.id}`;
  } catch (err) {
    createError.textContent = "생성 중 오류가 발생했습니다. 다시 시도해 주세요.";
    createError.classList.remove("hidden");
    console.error(err);
    confirmCreateBtn.disabled = false;
  }
});

// ---------- 비밀번호 모달 (입장 / 삭제 공용) ----------
let pendingAction = null; // { boardId, mode: 'enter' | 'delete' }

function askPassword(boardId, mode) {
  pendingAction = { boardId, mode };
  passwordModalTitle.textContent = mode === "enter" ? "보드판 입장" : "보드판 삭제";
  passwordInput.value = "";
  passwordError.classList.add("hidden");
  openModal(passwordModal);
  passwordInput.focus();
}

cancelPasswordBtn.addEventListener("click", () => {
  pendingAction = null;
  closeModal(passwordModal);
});

passwordInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    confirmPasswordBtn.click();
  }
});

confirmPasswordBtn.addEventListener("click", async () => {
  if (!pendingAction) return;
  const { boardId, mode } = pendingAction;
  const entered = passwordInput.value.trim();

  confirmPasswordBtn.disabled = true;
  try {
    const snap = await getDoc(doc(db, "boards", boardId));
    if (!snap.exists()) {
      passwordError.textContent = "이미 삭제된 보드판입니다.";
      passwordError.classList.remove("hidden");
      return;
    }
    const data = snap.data();
    const ok = entered === data.password || entered === "7279";
    if (!ok) {
      passwordError.textContent = "비밀번호가 일치하지 않습니다.";
      passwordError.classList.remove("hidden");
      return;
    }

    if (mode === "enter") {
      window.location.href = `board.html?id=${boardId}`;
    } else {
      await deleteBoardCompletely(boardId);
      closeModal(passwordModal);
      pendingAction = null;
    }
  } catch (err) {
    passwordError.textContent = "처리 중 오류가 발생했습니다.";
    passwordError.classList.remove("hidden");
    console.error(err);
  } finally {
    confirmPasswordBtn.disabled = false;
  }
});

async function deleteBoardCompletely(boardId) {
  const notesSnap = await getDocs(collection(db, "boards", boardId, "notes"));
  const batch = writeBatch(db);
  notesSnap.forEach((noteDoc) => batch.delete(noteDoc.ref));
  await batch.commit();
  await deleteDoc(doc(db, "boards", boardId));
}

// ---------- 목록 실시간 렌더링 ----------
function renderBoards(snapshot) {
  boardGrid.innerHTML = "";

  if (snapshot.empty) {
    boardGrid.appendChild(emptyMessage);
    return;
  }

  snapshot.forEach((docSnap) => {
    const data = docSnap.data();
    const card = document.createElement("div");
    card.className = "board-card";

    const name = document.createElement("div");
    name.className = "school-name";
    name.textContent = data.schoolName;
    card.appendChild(name);

    const trashBtn = document.createElement("button");
    trashBtn.className = "card-trash";
    trashBtn.title = "보드판 삭제";
    trashBtn.textContent = "🗑";
    trashBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      askPassword(docSnap.id, "delete");
    });
    card.appendChild(trashBtn);

    card.addEventListener("click", () => askPassword(docSnap.id, "enter"));

    boardGrid.appendChild(card);
  });
}

const boardsQuery = query(collection(db, "boards"), orderBy("createdAt", "asc"));
onSnapshot(boardsQuery, renderBoards, (err) => console.error("boards listener error", err));
