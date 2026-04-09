import { request } from '../api/httpClient';

export const driverSignupService = {
  uploadApplicationDocuments(formData) {
    return request('/drivers/upload-documents', {
      method: 'POST',
      body: formData,
    });
  },

  submitApplication(payload) {
    return request('/drivers/applications', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },
};
