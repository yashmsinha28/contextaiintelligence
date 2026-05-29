import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { Sparkles, FileText, MessageSquare, ShieldCheck, Zap } from "lucide-react";

export const Route = createFileRoute("/auth")({ component: AuthPage });

function AuthPage() {
  const navigate = useNavigate();
  const { user, loading } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!loading && user) navigate({ to: "/" });
  }, [user, loading, navigate]);

  const signIn = async () => {
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) return toast.error(error.message);
    navigate({ to: "/" });
  };

  const signUp = async () => {
    setBusy(true);
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: window.location.origin },
    });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Check your email to confirm your account.");
  };

  const google = async () => {
    const res = await lovable.auth.signInWithOAuth("google", { redirect_uri: window.location.origin });
    if (res.error) toast.error(res.error.message ?? "Google sign-in failed");
  };

  return (
    <div className="min-h-screen bg-[var(--gradient-subtle)]">
      <div className="mx-auto grid min-h-screen max-w-7xl grid-cols-1 lg:grid-cols-2">
        {/* Left: Overview */}
        <div className="relative hidden lg:flex flex-col justify-between p-12 text-primary-foreground overflow-hidden">
          <div className="absolute inset-0 bg-[var(--gradient-hero)]" />
          <div className="absolute -top-32 -right-32 h-96 w-96 rounded-full bg-white/10 blur-3xl" />
          <div className="absolute -bottom-32 -left-32 h-96 w-96 rounded-full bg-white/10 blur-3xl" />

          <div className="relative z-10 flex items-center gap-2 text-lg font-semibold">
            <Sparkles className="h-5 w-5" />
            RAG Assistant
          </div>

          <div className="relative z-10 space-y-8">
            <div>
              <h1 className="text-4xl xl:text-5xl font-bold leading-tight tracking-tight">
                Chat with your documents.
                <br />
                <span className="opacity-80">Instantly.</span>
              </h1>
              <p className="mt-4 text-base xl:text-lg opacity-90 max-w-md">
                Upload PDFs, notes, or research and ask anything. Your AI assistant retrieves the most relevant context and delivers precise, cited answers.
              </p>
            </div>

            <div className="grid gap-4 max-w-md">
              {[
                { icon: FileText, title: "Upload anything", desc: "PDF, TXT, Markdown — up to 20 MB." },
                { icon: MessageSquare, title: "Ask in plain English", desc: "Conversational, context-aware answers." },
                { icon: ShieldCheck, title: "Private by design", desc: "Your files are isolated to your account." },
                { icon: Zap, title: "Fast retrieval", desc: "Vector search powered by embeddings." },
              ].map((f) => (
                <div key={f.title} className="flex items-start gap-3">
                  <div className="rounded-lg bg-white/15 p-2 backdrop-blur">
                    <f.icon className="h-4 w-4" />
                  </div>
                  <div>
                    <div className="font-medium text-sm">{f.title}</div>
                    <div className="text-xs opacity-80">{f.desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="relative z-10 text-xs opacity-70">
            © {new Date().getFullYear()} RAG Assistant. Built with care.
          </div>
        </div>

        {/* Right: Auth */}
        <div className="flex items-center justify-center p-6 sm:p-12">
          <Card className="w-full max-w-md border-0 shadow-[var(--shadow-elegant)]">
            <CardHeader className="space-y-1">
              <div className="lg:hidden flex items-center gap-2 text-primary font-semibold mb-2">
                <Sparkles className="h-5 w-5" /> RAG Assistant
              </div>
              <CardTitle className="text-2xl">Welcome</CardTitle>
              <CardDescription>Sign in or create an account to get started.</CardDescription>
            </CardHeader>
            <CardContent>
              <Tabs defaultValue="signin" className="w-full">
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="signin">Sign in</TabsTrigger>
                  <TabsTrigger value="signup">Sign up</TabsTrigger>
                </TabsList>
                <TabsContent value="signin" className="space-y-3 mt-4">
                  <div className="space-y-2">
                    <Label>Email</Label>
                    <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
                  </div>
                  <div className="space-y-2">
                    <Label>Password</Label>
                    <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
                  </div>
                  <Button className="w-full" onClick={signIn} disabled={busy}>Sign in</Button>
                </TabsContent>
                <TabsContent value="signup" className="space-y-3 mt-4">
                  <div className="space-y-2">
                    <Label>Email</Label>
                    <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
                  </div>
                  <div className="space-y-2">
                    <Label>Password</Label>
                    <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 6 characters" />
                  </div>
                  <Button className="w-full" onClick={signUp} disabled={busy}>Create account</Button>
                </TabsContent>
              </Tabs>
              <div className="my-4 flex items-center gap-2 text-xs text-muted-foreground">
                <div className="h-px flex-1 bg-border" /> OR <div className="h-px flex-1 bg-border" />
              </div>
              <Button variant="outline" className="w-full" onClick={google}>
                Continue with Google
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
