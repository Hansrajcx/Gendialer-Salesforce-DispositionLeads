const {
  createDispositionLead,
  updateDispositionLead,
  searchDispositionLeads,
} = require('../services/salesforce/dispositionLead');

async function create(req, res, next) {
  try {
    const id = await createDispositionLead(req.body);
    res.status(201).json({
      success: true,
      id,
      message: 'Disposition lead created successfully',
    });
  } catch (error) {
    next(error);
  }
}

async function update(req, res, next) {
  try {
    const id = await updateDispositionLead(req.params.id, req.body);
    res.status(200).json({
      success: true,
      id,
      message: 'Disposition lead updated successfully',
    });
  } catch (error) {
    next(error);
  }
}

async function list(req, res, next) {
  try {
    const result = await searchDispositionLeads(req.query);
    res.status(200).json({
      success: true,
      ...result,
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  create,
  update,
  list,
};
