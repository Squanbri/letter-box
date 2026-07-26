import { Badge } from '@mantine/core';

export function SmartSummaryCard() {
  return (
    <section className="dashboard-card insight-card">
      <header><div><span className="eyebrow">Сводка</span><h2>Умный обзор</h2></div><Badge variant="light">Скоро</Badge></header>
      <div className="insight-placeholder">
        <span className="insight-mark">✦</span>
        <strong>Здесь появится AI-сводка</strong>
        <p>Важные письма, задачи и темы дня — без необходимости разбирать весь входящий поток.</p>
      </div>
    </section>
  );
}
