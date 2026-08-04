import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";

// Real backend check: confirms the current user's email appears in the
// AuthorizedPerson whitelist. This is a server-side data query through the
// authenticated SDK — the result cannot be spoofed from the client, so the
// route guard can safely fail closed on it. Returns null while loading or
// when there is no email to check (i.e. user not authenticated yet).
export function useAuthorizedPerson(email) {
  const normalizedEmail = typeof email === "string" ? email.toLowerCase() : "";

  const { data, isLoading } = useQuery({
    queryKey: ["authorized-person", normalizedEmail],
    queryFn: async () => {
      if (!normalizedEmail) return null;
      const allPeople = await base44.entities.AuthorizedPerson.list();
      return (
        allPeople.find(
          (p) => p.email && p.email.toLowerCase() === normalizedEmail,
        ) || null
      );
    },
    enabled: !!normalizedEmail,
    staleTime: 1000 * 60 * 2,
  });

  return {
    authorizedPerson: data,
    isChecking: isLoading,
    isAuthorized: !!data,
  };
}