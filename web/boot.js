    try {
      if (localStorage.getItem('dojo.sidebarCollapsed') === 'true') document.documentElement.dataset.sidebarCollapsed = 'true';
      const theme = localStorage.getItem('dojo.theme');
      if (['paper', 'studio', 'midnight', 'slate'].includes(theme)) document.documentElement.dataset.theme = theme;
    } catch {}
