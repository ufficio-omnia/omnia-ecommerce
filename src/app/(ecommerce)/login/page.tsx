import type { Metadata } from "next";
import LoginForm from "./login-form";

export const metadata: Metadata = {
  title: "Accedi",
};

export default function LoginPage() {
  return <LoginForm />;
}
