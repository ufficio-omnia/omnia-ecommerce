import type { Metadata } from "next";
import RegistratiForm from "./registrati-form";

export const metadata: Metadata = {
  title: "Registrati",
};

export default function RegistratiPage() {
  return <RegistratiForm />;
}
