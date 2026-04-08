import { handleApiRequest, handleNetlifyError } from './_lib/app.mjs';

export default async (request) => {
  try {
    return await handleApiRequest(request);
  } catch (error) {
    return handleNetlifyError(error);
  }
};

export const config = {
  path: '/api/*'
};
