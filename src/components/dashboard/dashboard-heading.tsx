export function DashboardHeading({ title, description }: { title: string; description: string }) {
  return <div className="dashboard-heading"><h1>{title}</h1><p>{description}</p></div>;
}
