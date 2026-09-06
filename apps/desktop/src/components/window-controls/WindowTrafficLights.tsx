/** Native-like window controls rendered in HTML (vertical stack for the rail). */
export function WindowTrafficLights({
  vertical = true,
  className = '',
}: {
  vertical?: boolean;
  className?: string;
}) {
  const bridge = window.letterBoxWindow;
  if (!bridge) return null;

  return (
    <div
      className={[
        'traffic-lights',
        vertical ? 'vertical' : 'horizontal',
        className,
      ].filter(Boolean).join(' ')}
      aria-label="Управление окном"
    >
      <button
        type="button"
        className="traffic-btn close"
        title="Закрыть"
        onClick={() => void bridge.close()}
      />
      <button
        type="button"
        className="traffic-btn minimize"
        title="Свернуть"
        onClick={() => void bridge.minimize()}
      />
      <button
        type="button"
        className="traffic-btn zoom"
        title="На весь экран"
        onClick={() => void bridge.maximize()}
      />
    </div>
  );
}
