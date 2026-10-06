// Food Truck - /history.html. The truck's own orders (GET /api/orders), newest first.
// The server scopes the list to the session location; this page sends no location.
'use strict';

(() => {
  document.addEventListener('DOMContentLoaded', async () => {
    const user = await App.requireUser(['truck']);
    if (!user) return;
    await load();
  });

  async function load() {
    const list = document.getElementById('history-list');
    const res = await App.api('GET', '/api/orders');
    list.setAttribute('aria-busy', 'false');
    if (res.status === 401) { window.location.replace('/'); return; }
    if (res.status !== 200) {
      App.setNotice(document.getElementById('history-error'), 'error', App.errorText(res, 'Could not load your orders.'));
      return;
    }
    list.replaceChildren();
    if (res.json.orders.length === 0) {
      list.appendChild(App.el('p', 'muted', 'No orders yet. Place one from the stock page.'));
      return;
    }
    for (const order of res.json.orders) list.appendChild(card(order));
  }

  function card(order) {
    const node = App.el('div', 'card');
    node.dataset.orderId = String(order.id);

    const row = App.el('div', 'card-row');
    row.appendChild(App.el('span', 'card-title', 'Order #' + order.id));
    row.appendChild(App.statusBadge(order.status));
    node.appendChild(row);

    const count = order.lines.length + (order.lines.length === 1 ? ' line' : ' lines');
    const created = App.el('div', 'muted', App.dateTime(order.created_at) + ' · ' + count + ' · cost ' + App.money(order.cost_total));
    created.dataset.lineCount = String(order.lines.length);
    node.appendChild(created);
    if (order.status_updated_at) {
      node.appendChild(App.el('div', 'muted', App.statusLabel(order.status) + ' since ' + App.dateTime(order.status_updated_at)));
    }
    if (order.note) node.appendChild(App.el('div', null, 'Note: ' + order.note));

    const details = document.createElement('details');
    details.appendChild(App.el('summary', null, 'Items'));
    const ul = App.el('ul', 'lines');
    for (const line of order.lines) {
      const li = document.createElement('li');
      li.appendChild(App.el('span', null, line.qty + ' x ' + line.name + ' (' + line.unit + ')'));
      li.appendChild(App.el('span', null, App.money(line.line_cost)));
      ul.appendChild(li);
    }
    details.appendChild(ul);
    node.appendChild(details);
    return node;
  }
})();
