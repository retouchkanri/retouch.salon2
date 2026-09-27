import { redirect } from "next/navigation";

export default function MyPageBookingLegacyRedirect() {
  redirect("/mypage/bookings");
}
