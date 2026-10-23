import { Link } from "react-router-dom";
import { Pill } from "./ui";

export default function ClassBadge({ class_id, class_name }: { class_id?: string | null; class_name?: string | null }) {
  if (!class_name) return null;
  const badge = <Pill tone="blue">Class: {class_name}</Pill>;
  return class_id ? <Link to={`/admin/classes/${class_id}`} aria-label={`View class ${class_name}`} style={{ textDecoration: "none" }}>{badge}</Link> : badge;
}
