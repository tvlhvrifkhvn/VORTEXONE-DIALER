export default function Badge({ children, color = '#6A7A94', className = '' }) {
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${className}`}
      style={{ backgroundColor: `${color}1A`, color }}
    >
      {children}
    </span>
  );
}
