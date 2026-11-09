interface CategoryRow {
  id: string;
  name: string;
  description: string | null;
  minAge: number | null;
  maxAge: number | null;
  defaultCost: { toString(): string };
  usesElo: boolean;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface CategoryDto {
  id: string;
  name: string;
  description: string | null;
  minAge: number | null;
  maxAge: number | null;
  defaultCost: number;
  usesElo: boolean;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export function toCategoryDto(category: CategoryRow): CategoryDto {
  return {
    id: category.id,
    name: category.name,
    description: category.description,
    minAge: category.minAge,
    maxAge: category.maxAge,
    defaultCost: Number(category.defaultCost.toString()),
    usesElo: category.usesElo,
    isActive: category.isActive,
    createdAt: category.createdAt,
    updatedAt: category.updatedAt,
  };
}
