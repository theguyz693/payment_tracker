import { LegalPage } from "@/components/landing/LegalPage";

export const metadata = { title: "Terms" };

export default function TermsPage() {
  return (
    <LegalPage title="Terms">
      <p>Payment Tracker helps you keep a record of payments you need to make and money you expect to receive.</p>
      <h2>It&apos;s a record, not a bank</h2>
      <p>
        The app doesn&apos;t move money. Marking something as paid only updates your own records. Amounts and dates are whatever
        you enter, so please double-check anything important.
      </p>
      <h2>Your account</h2>
      <p>Keep your password private. You&apos;re responsible for what&apos;s entered in your account.</p>
      <h2>Availability</h2>
      <p>The app is provided as-is and may change over time.</p>
    </LegalPage>
  );
}
