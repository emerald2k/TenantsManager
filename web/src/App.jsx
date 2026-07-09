import { Button } from '@/components/ui/button'

function App() {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-4">
      <h1 className="text-2xl font-semibold text-foreground">
        TenantsManager
      </h1>
      <p className="text-muted-foreground">
        Vite + React + Tailwind CSS + shadcn/ui — sub-etapa B
      </p>
      <Button>shadcn/ui Button</Button>
    </div>
  )
}

export default App
