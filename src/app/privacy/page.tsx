import { LegalPage } from "@/components/landing/LegalPage";

export const metadata = { title: "Privacy" };

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy">
      <p>Payment Tracker is a small personal finance app. This page explains, in plain words, what it stores and why.</p>
      <h2>What we store</h2>
      <p>
        Your name, email address and a securely hashed version of your password, so you can log in. The payments and
        receivables you enter (titles, amounts, dates, categories and notes), so the app can show them back to you.
      </p>
      <h2>What we don&apos;t do</h2>
      <p>
        We don&apos;t connect to your bank, don&apos;t sell or share your data, and don&apos;t show ads. Your entries are only
        visible to your account.
      </p>
      <h2>Deleting your data</h2>
      <p>Ask the person who runs this app and your account and entries will be removed.</p>
    </LegalPage>
  );
}
