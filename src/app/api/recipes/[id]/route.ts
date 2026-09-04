import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/db";
import { validateRecipeInput, serializeRecipe } from "@/lib/recipes";
import { userTranslator } from "@/lib/i18n-server";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const recipe = await prisma.recipe.findFirst({ where: { id, userId: session.userId } });
  if (!recipe) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json({ recipe: serializeRecipe(recipe) });
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const recipe = await prisma.recipe.findFirst({ where: { id, userId: session.userId } });
  if (!recipe) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await request.json();

  if (body.cooked === true) {
    // Lightweight "I cooked this" signal — bumps the counter only
    const updated = await prisma.recipe.update({
      where: { id: recipe.id },
      data: { timesCooked: { increment: 1 } },
    });
    return NextResponse.json({ recipe: serializeRecipe(updated) });
  }

  const validated = validateRecipeInput({
    title: body.title ?? recipe.title,
    ingredients: body.ingredients ?? recipe.ingredients,
    steps: body.steps ?? recipe.steps,
    tags: body.tags ?? recipe.tags,
    servings: body.servings !== undefined ? body.servings : recipe.servings,
    timeMin: body.timeMin !== undefined ? body.timeMin : recipe.timeMin,
    notes: body.notes !== undefined ? body.notes : recipe.notes,
  });
  if (!validated.ok) {
    const t = await userTranslator(session.userId);
    return NextResponse.json({ error: t(`api.validation.recipe.${validated.code}`, validated.vars) }, { status: 400 });
  }

  const updated = await prisma.recipe.update({
    where: { id: recipe.id },
    data: {
      title: validated.recipe.title,
      ingredients: validated.recipe.ingredients,
      steps: validated.recipe.steps,
      tags: validated.recipe.tags,
      servings: validated.recipe.servings,
      timeMin: validated.recipe.timeMin,
      notes: validated.recipe.notes,
    },
  });
  return NextResponse.json({ recipe: serializeRecipe(updated) });
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const recipe = await prisma.recipe.findFirst({ where: { id, userId: session.userId } });
  if (!recipe) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await prisma.recipe.delete({ where: { id: recipe.id } });
  return NextResponse.json({ ok: true });
}
