import { signInWithGoogle, signOut, getCurrentUser } from './supabase.js';

document.getElementById("btnGoogle").addEventListener("click", async () => {
  const result = await signInWithGoogle();
  console.log("Google redirect:", result);
});

document.getElementById("btnLogout").addEventListener("click", async () => {
  await signOut();
  alert("Đã đăng xuất!");
});

async function loadUser() {
  const user = await getCurrentUser();
  if (user) {
    document.getElementById("userInfo").innerHTML =
      `Đăng nhập: <b>${user.email}</b>`;
  } else {
    document.getElementById("userInfo").innerHTML = "Chưa đăng nhập";
  }
}

loadUser();
