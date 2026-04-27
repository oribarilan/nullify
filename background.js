chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.url?.includes('teams.cloud.microsoft')) return;

  try {
    await chrome.tabs.sendMessage(tab.id, { action: 'toggle' });
  } catch {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['content.js']
    });
    await new Promise(r => setTimeout(r, 500));
    try {
      await chrome.tabs.sendMessage(tab.id, { action: 'toggle' });
    } catch (e) {
      console.error('Nullify: Failed to activate', e);
    }
  }
});
