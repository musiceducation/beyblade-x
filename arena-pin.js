/**
 * Simple admin PIN for destructive arena actions (localStorage, default 1234).
 */
const ARENA_PIN_KEY = 'bex-arena-admin-pin';
const ARENA_PIN_DEFAULT = '1234';

function getArenaPin() {
  return localStorage.getItem(ARENA_PIN_KEY) || ARENA_PIN_DEFAULT;
}

function setArenaPin(pin) {
  if (!pin) return;
  localStorage.setItem(ARENA_PIN_KEY, String(pin));
}

function confirmArenaPin(actionLabel) {
  const input = prompt(`${actionLabel}\n輸入管理 PIN：`);
  if (input === null) return false;
  if (input === getArenaPin()) return true;
  alert('PIN 錯誤');
  return false;
}
