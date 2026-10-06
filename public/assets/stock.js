// Food Truck - /stock.html. Stock status for every role; the order form for truck users only.
// Franchise users get status only: no quantities, no cost, no order controls (SPEC 3).
'use strict';

(() => {
  const SOURCE_TEXT = {
    fincon: 'Live stock from FinCon',
    cache: 'Stock from the last FinCon check',
    unavailable: 'FinCon is unavailable right now. Everything shows as in stock - HQ will confirm.',
  };

  let user = null;

  document.addEventListener('DOMContentLoaded', async () => {
    user = await App.requireUser(['truck', 'franchise', 'hq']);
    if (!user) return;
    if (user.role === 'hq') document.getElementById('nav-hq').hidden = false;
    await load();
  });

  async function load() {
    const list = document.getElementById('stock-list');
    const isTruck = user.role === 'truck';
    const [stock, products] = await Promise.all([
      App.api('GET', '/api/stock'),
      isTruck ? App.api('GET', '/api/products') : Promise.resolve(null),
    ]);
    list.setAttribute('aria-busy', 'false');

    if (stock.status === 401) { window.location.replace('/'); return; }
    if (stock.status !== 200) {
      App.setNotice(document.getElementById('stock-error'), 'error', App.errorText(stock, 'Could not load stock.'));
      return;
    }
    const sourceNode = document.getElementById('stock-source');
    sourceNode.textContent = (SOURCE_TEXT[stock.json.source] || '') + ' · ' + App.dateTime(stock.json.checked_at);

    const bySku = {};
    if (products && products.status === 200) {
      for (const p of products.json.items) bySku[p.sku] = p;
    }

    list.replaceChildren();
    let category = null;
    for (const item of stock.json.items) {
      if (item.category !== category) {
        category = item.category;
        list.appendChild(App.el('h2', 'category', category));
      }
      list.appendChild(card(item, isTruck ? bySku[item.sku] : null, isTruck));
    }

    if (isTruck) {
      document.getElementById('order-panel').hidden = false;
      document.getElementById('order-form').addEventListener('submit', placeOrder);
    }
  }

  function card(item, product, isTruck) {
    const node = App.el('div', 'card');
    node.dataset.sku = item.sku;

    const row = App.el('div', 'card-row');
    row.appendChild(App.el('span', 'card-title', item.name));
    row.appendChild(App.statusBadge(item.status));
    node.appendChild(row);

    let meta = item.sku + ' · per ' + item.unit;
    if (product) meta += ' · cost ' + App.money(product.unit_cost) + (product.moq > 1 ? ' · usual order ' + product.moq : '');
    node.appendChild(App.el('div', 'muted', meta));

    if (isTruck) {
      const qty = App.el('div', 'qty');
      const id = 'qty-' + item.sku;
      const label = App.el('label', null, 'Qty');
      label.htmlFor = id;
      const input = document.createElement('input');
      input.type = 'number';
      input.id = id;
      input.min = '0';
      input.max = '999';
      input.step = '1';
      input.inputMode = 'numeric';
      input.placeholder = '0';
      input.dataset.qtyFor = item.sku;
      qty.appendChild(label);
      qty.appendChild(input);
      node.appendChild(qty);
    }
    return node;
  }

  async function placeOrder(e) {
    e.preventDefault();
    const error = document.getElementById('order-error');
    const confirmation = document.getElementById('order-confirmation');
    const button = document.getElementById('place-order');
    App.setNotice(error, 'error', '');

    const lines = [];
    for (const input of document.querySelectorAll('input[data-qty-for]')) {
      const raw = input.value.trim();
      if (raw === '' || raw === '0') continue;
      const qty = Number(raw);
      if (!Number.isInteger(qty) || qty < 1 || qty > 999) {
        App.setNotice(error, 'error', 'Quantities must be whole numbers from 1 to 999.');
        input.focus();
        return;
      }
      lines.push({ sku: input.dataset.qtyFor, qty });
    }
    if (lines.length === 0) {
      App.setNotice(error, 'error', 'Enter a quantity for at least one item.');
      return;
    }

    const body = { lines };
    const note = document.getElementById('order-note').value.trim();
    if (note) body.note = note;

    button.disabled = true;
    const res = await App.api('POST', '/api/orders', body);
    button.disabled = false;

    if (res.status === 401) { window.location.replace('/'); return; }
    if (res.status !== 201 || !res.json || !res.json.order) {
      App.setNotice(error, 'error', App.errorText(res, 'The order was not placed.'));
      return;
    }
    const order = res.json.order;
    confirmation.dataset.orderId = String(order.id);
    confirmation.textContent = 'Order #' + order.id + ' placed with HQ: ' + order.lines.length
      + (order.lines.length === 1 ? ' item' : ' items') + ', cost ' + App.money(order.cost_total) + '.';
    confirmation.hidden = false;
    for (const input of document.querySelectorAll('input[data-qty-for]')) input.value = '';
    document.getElementById('order-note').value = '';
    confirmation.scrollIntoView({ block: 'nearest' });
  }
})();
