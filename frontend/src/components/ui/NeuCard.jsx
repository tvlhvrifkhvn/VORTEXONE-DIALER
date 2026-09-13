export default function NeuCard({ children, className = '', inset = false, ...props }) {
  return (
    <div
      className={`bg-surface rounded-card ${inset ? 'shadow-neu-inset' : 'shadow-neu'} ${className}`}
      {...props}
    >
      {children}
    </div>
  );
}
