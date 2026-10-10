import { getSettings, saveSettings } from './settings';

const form = document.getElementById('form') as HTMLFormElement;
const userId = document.getElementById('userId') as HTMLInputElement;
const backendUrl = document.getElementById('backendUrl') as HTMLInputElement;
const status = document.getElementById('status')!;

getSettings().then((s) => {
  userId.value = s.userId;
  backendUrl.value = s.backendUrl;
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  await saveSettings({ userId: userId.value.trim(), backendUrl: backendUrl.value.trim() });
  status.textContent = 'Saved.';
  setTimeout(() => (status.textContent = ''), 2000);
});
