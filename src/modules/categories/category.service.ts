import { badRequest, conflict, notFound } from '../../shared/errors.js';
import { paginate } from '../../shared/pagination.js';
import { isUniqueViolation } from '../../shared/prisma-errors.js';
import { toCategoryDto, type CategoryDto } from './category.dto.js';
import { categoryRepository } from './category.repository.js';
import {
  hasValidAgeRange,
  type CreateCategoryInput,
  type ListCategoriesQuery,
  type UpdateCategoryInput,
} from './category.schemas.js';

const duplicated = () => conflict('CATEGORY_DUPLICATE', 'Ya existe una categoría con ese nombre');

export const categoryService = {
  async list(query: ListCategoriesQuery) {
    const { rows, total } = await categoryRepository.list(query);
    return paginate(rows.map(toCategoryDto), query.page, query.limit, total);
  },

  async getById(id: string): Promise<CategoryDto> {
    const category = await categoryRepository.findById(id);
    if (!category) throw notFound('La categoría no existe');
    return toCategoryDto(category);
  },

  async create(input: CreateCategoryInput, createdById: string): Promise<CategoryDto> {
    if (await categoryRepository.findByName(input.name)) throw duplicated();
    try {
      const category = await categoryRepository.create({ ...input, createdById });
      return toCategoryDto(category);
    } catch (error) {
      if (isUniqueViolation(error)) throw duplicated();
      throw error;
    }
  },

  async update(id: string, input: UpdateCategoryInput): Promise<CategoryDto> {
    const current = await categoryRepository.findById(id);
    if (!current) throw notFound('La categoría no existe');

    // El rango de edades se valida con los valores resultantes, no solo con los enviados
    const merged = {
      minAge: input.minAge === undefined ? current.minAge : input.minAge,
      maxAge: input.maxAge === undefined ? current.maxAge : input.maxAge,
    };
    if (!hasValidAgeRange(merged)) {
      throw badRequest('Los datos enviados no son válidos', [
        { field: 'minAge', message: 'La edad mínima no puede ser mayor que la máxima' },
      ]);
    }

    if (input.name !== undefined && input.name.toLowerCase() !== current.name.toLowerCase()) {
      if (await categoryRepository.findByName(input.name)) throw duplicated();
    }

    try {
      const category = await categoryRepository.update(id, input);
      return toCategoryDto(category);
    } catch (error) {
      if (isUniqueViolation(error)) throw duplicated();
      throw error;
    }
  },

  async deactivate(id: string): Promise<CategoryDto> {
    const current = await categoryRepository.findById(id);
    if (!current) throw notFound('La categoría no existe');
    if (!current.isActive) return toCategoryDto(current);
    return toCategoryDto(await categoryRepository.update(id, { isActive: false }));
  },
};
