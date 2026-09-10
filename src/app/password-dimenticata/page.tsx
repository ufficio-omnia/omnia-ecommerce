import type { Metadata } from "next";
import PasswordDimenticataForm from "./password-dimenticata-form";

export const metadata: Metadata = {
  title: "Password dimenticata",
};

export default function PasswordDimenticataPage() {
  return <PasswordDimenticataForm />;
}
