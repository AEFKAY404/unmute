const form = document.getElementById("admin-login-form");
const passwordInput = document.getElementById("password");
const errorText = document.getElementById("login-error");

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  errorText.classList.add("hidden");

  const response = await fetch("/admin/login", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      password: passwordInput.value,
    }),
  });

  if (!response.ok) {
    errorText.classList.remove("hidden");
    return;
  }

  window.location.assign("/admin");
});
