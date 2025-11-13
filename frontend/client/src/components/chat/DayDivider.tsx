export function DayDivider({ isoDay }: { isoDay: string }) {
  const date = new Date(isoDay);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  
  let label: string;
  if (date.toDateString() === today.toDateString()) {
    label = "Today";
  } else if (date.toDateString() === yesterday.toDateString()) {
    label = "Yesterday";
  } else {
    label = date.toLocaleDateString(undefined, { 
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric"
    });
  }

  return (
    <div 
      className="day-divider" 
      role="separator" 
      aria-label={`Messages from ${label}`}
    >
      <span className="day-divider-label">{label}</span>
    </div>
  );
}
  