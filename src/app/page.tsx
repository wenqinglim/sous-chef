import AddRecipeForm from "@/components/AddRecipeForm";
import RecipeLibraryGrid from "@/components/RecipeLibraryGrid";

export default function HomePage() {
  return (
    <main className="max-w-3xl mx-auto px-4 py-8">
      <div className="mb-6">
        <h2 className="text-xl font-semibold text-stone-900">Your recipes</h2>
        <p className="text-sm text-stone-500 mt-1">
          Save recipes from any URL, open one to read its ingredients and steps,
          and build a grocery list when you&apos;re ready.
        </p>
      </div>

      <AddRecipeForm />
      <RecipeLibraryGrid />
    </main>
  );
}
