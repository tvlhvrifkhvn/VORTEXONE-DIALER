export default function NeuInput({ className = '', as = 'input', ...props }) {
  const Component = as;
  return (
    <Component
      className={`
        bg-surface rounded-input shadow-neu-inset px-3 py-2 text-text-primary
        placeholder:text-text-secondary outline-none
        focus:ring-2 focus:ring-action-call/40
        ${className}
      `}
      {...props}
    />
  );
}
