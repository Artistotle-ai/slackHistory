// Placeholder for Lambda layer
// Actual content is published by CodePipeline
// This ensures the zip file is not empty when CDK packages it

// Ensure this file has enough content to not be empty
module.exports = {
  version: 'placeholder-1.0.0',
  note: 'Actual layer content deployed by CodePipeline',
  timestamp: new Date().toISOString()
};

console.log('Placeholder Lambda layer loaded - actual content deployed by pipeline');
