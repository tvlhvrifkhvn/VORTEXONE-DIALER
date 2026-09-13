export default function NeuCard({ children, className = '', inset = false, ...props }) {
  return (
    <div
      className={`neu-card bg-surface rounded-card ${inset ? 'shadow-neu-inset' : 'shadow-neu'} ${className}`}
      {...props}
    >
      {children}
    </div>
  );
}
