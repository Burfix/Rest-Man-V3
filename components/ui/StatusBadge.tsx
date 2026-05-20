import Badge from "./Badge";
import { ReservationStatus } from "@/types";

interface Props {
  status: ReservationStatus;
}

export default function StatusBadge({ status }: Props) {
  switch (status) {
    case "confirmed":
      return <Badge color="green">Confirmed</Badge>;
    case "completed":
      return <Badge color="green">Completed</Badge>;
    case "cancelled":
      return <Badge color="red">Cancelled</Badge>;
    case "pending":
    default:
      return <Badge color="amber">Pending</Badge>;
  }
}
