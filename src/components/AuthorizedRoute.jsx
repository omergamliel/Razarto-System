import { Navigate } from "react-router-dom";
import { useAuth } from "@/lib/AuthContext";
import { useAuthorizedPerson } from "@/hooks/useAuthorizedPerson";

const FullScreenLoader = () => (
  <div className="fixed inset-0 flex items-center justify-center">
    <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin"></div>
  </div>
);

// Security gate for the Home page. Fails CLOSED: the protected page never
// mounts until BOTH checks resolve true —
//   (1) platform authentication (token verified by AuthProvider)
//   (2) membership in the AuthorizedPerson whitelist (real backend query)
// While either is loading we render only a loader, so no protected content
// reaches the DOM before confirmation. Any failure redirects to /login,
// where the Login page decides whether to offer a login button or an
// "not authorized" screen. There is no client-only bypass: even if an
// attacker navigates directly to "/", the backend query returns null and
// they are redirected.
export default function AuthorizedRoute({ children }) {
  const { isAuthenticated, isLoadingAuth, user } = useAuth();
  const { isChecking, isAuthorized } = useAuthorizedPerson(user?.email);

  if (isLoadingAuth || (isAuthenticated && isChecking)) {
    return <FullScreenLoader />;
  }

  if (!isAuthenticated || !isAuthorized) {
    return <Navigate to="/login" replace />;
  }

  return children;
}