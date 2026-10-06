// Food Truck - /hq.html. HQ inbox of truck orders; move each order forward as it is
// picked and delivered (SPEC 5). Status only ever moves forward; skips are allowed.
'use strict';

(() => {
  const STATUSES = ['pending', 'in_process', 'out_for_delivery', 'delivered'];

  document.addEventListener('DOMContentLoaded', async () => {
    const user = await App.requireUser(['hq']);
    if (!user) return;
    document.getElementById('hq-filter').addEventListener('change', load);
    await load();
  });

  async function load() {
    const list = document.getElementById('hq-orders');
    const error = document.getElementById('hq-error');
    const filter = document.getElementById('hq-filter').value;
    App.setNotice(error, 'error', '');
    list.setAttribute('aria-busy', 'true');
    const res = await App.api('GET', '/api/hq/orders' + (filter ? '?status=' + encodeURIComponent(filter) : ''));
    list.setAttribute('aria-busy', 'false');
    if (res.status === 401) { window.location.replace('/'); return; }
    if (res.status !== 200) {
      App.setNotice(error, 'error', App.errorText(res, 'Could not load orders.'));
      return;
    }
    list.replaceChildren();
    if (res.json.orders.length === 0) {
      list.appendChild(App.el('p', 'muted', 'No truck orders.'));
      return;
    }
    for (const order of res.json.orders) list.appendChild(card(order));
  }

  function card(order) {
    const node = App.el('div', 'card');
    node.dataset.orderId = String(order.id);
    fill(node, order);
    return node;
  }

  function fill(node, order) {
    node.replaceChildren();
    const row = App.el('div', 'card-row');
    row.appendChild(App.el('span', 'card-title', 'Order #' + order.id + ' · ' + order.location.name));
    row.appendChild(App.statusBadge(order.status));
    node.appendChild(row);

    const count = order.lines.length + (order.lines.length === 1 ? ' line' : ' lines');
    node.appendChild(App.el('div', 'muted', App.dateTime(order.created_at) + ' · ' + order.created_by.username
      + ' · ' + count + ' · cost ' + App.money(order.cost_total)));
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

    const next = STATUSES.slice(STATUSES.indexOf(order.status) + 1);
    if (next.length > 0) {
      const actions = App.el('div', 'actions');
      for (const status of next) {
        const btn = App.el('button', null, App.statusLabel(status));
        btn.type = 'button';
        btn.dataset.nextStatus = status;
        btn.addEventListener('click', () => move(node, order.id, status, btn));
        actions.appendChild(btn);
      }
      node.appendChild(actions);
    }
    const error = App.el('div', 'notice error');
    error.setAttribute('role', 'alert');
    node.appendChild(error);
  }

  async function move(node, id, status, btn) {
    for (const b of node.querySelectorAll('button[data-next-status]')) b.disabled = true;
    const res = await App.api('POST', '/api/hq/orders/' + id + '/status', { status });
    if (res.status === 401) { window.location.replace('/'); return; }
    if (res.status === 200 && res.json && res.json.order) {
      fill(node, res.json.order);
      return;
    }
    for (const b of node.querySelectorAll('button[data-next-status]')) b.disabled = false;
    App.setNotice(node.querySelector('.notice.error'), 'error', App.errorText(res, 'Status was not changed.'));
    btn.focus();
  }
})();
