import { redirect } from "next/navigation";
import { DEFAULT_CATEGORY } from "@/config/categories";

export default function Home() {
  redirect(`/${DEFAULT_CATEGORY}`);
}
