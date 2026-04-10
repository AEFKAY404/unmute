const DEFAULT_SETTINGS = {
  enabled: true,
  theme: "light",
  displayName: "",
};

const form = document.getElementById("settings-form");
const enabledInput = document.getElementById("enabled");
const darkModeInput = document.getElementById("dark-mode");
const displayNameInput = document.getElementById("display-name");
const status = document.getElementById("status");

function applyPopupTheme(theme) {
  document.documentElement.dataset.theme = theme === "dark" ? "dark" : "light";
}

async function loadSettings() {
  const settings = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  enabledInput.checked = Boolean(settings.enabled);
  darkModeInput.checked = settings.theme === "dark";
  displayNameInput.value = settings.displayName || "";
  applyPopupTheme(settings.theme);
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const displayName = displayNameInput.value.trim().slice(0, 30);
  const theme = darkModeInput.checked ? "dark" : "light";

  await chrome.storage.sync.set({
    enabled: enabledInput.checked,
    theme,
    displayName,
  });

  applyPopupTheme(theme);
  status.textContent = "Saved.";
  window.setTimeout(() => {
    status.textContent = "";
  }, 1500);
});

loadSettings().catch((error) => {
  status.textContent = error.message;
});
