import { ForgotPasswordForm } from "./ForgotPasswordForm";

export const metadata = {
  title: "Forgot Password — Si Cantina Sociale",
};

export default function ForgotPasswordPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-stone-50 px-6 py-12">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <p className="text-xs font-bold uppercase tracking-widest text-amber-600">
            Si Cantina Sociale
          </p>
          <h1 className="mt-2 text-2xl font-bold text-stone-900">
            Reset your password
          </h1>
          <p className="mt-1 text-sm text-stone-500">
            Enter your email and we&apos;ll send you a reset link.
          </p>
        </div>

        <div className="rounded-2xl border border-stone-200 bg-white px-8 py-9 shadow-sm">
          <ForgotPasswordForm />
        </div>
      </div>
    </div>
  );
}
