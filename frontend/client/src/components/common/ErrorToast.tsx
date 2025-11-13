type Props = { message: string };

export function ErrorToast({ message }: Props) {
  return (
    <div className="toast error" role="alert">
      {message}
    </div>
  );
}
