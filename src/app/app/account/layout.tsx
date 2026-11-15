// The signed-in user's own account pages (two-factor setup and sign-in code).
// Each page picks its own frame: the sign-in code and the required admin setup
// use the centred auth layout; managing authenticator apps sits in the company
// shell (./shell.tsx).
export default function AccountLayout({ children }: LayoutProps<"/app/account">) {
  return <>{children}</>;
}
