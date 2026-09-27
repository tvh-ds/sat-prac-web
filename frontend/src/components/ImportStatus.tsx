export default function ImportStatus({ status }: { status: string }) {
  const tone = (s: string) => {
    if (s === "completed") return "green";
    if (s === "failed") return "red";
    if (["uploaded", "extracting", "parsing"].includes(s)) return "amber";
    return "gray";
  };
  const label = (s: string) => {
    switch (s) {
      case "completed": return "Completed";
      case "failed": return "Failed";
      case "extracting": return "Extracting";
      case "parsing": return "Parsing";
      default: return s.charAt(0).toUpperCase() + s.slice(1);
    }
  };
  return <span className={`pill pill-${tone(status)}`}>{label(status)}</span>;
}
