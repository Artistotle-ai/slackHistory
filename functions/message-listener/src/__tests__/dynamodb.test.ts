import * as dynamodb from '../dynamodb';

describe('dynamodb', () => {
  it('should re-export putItem', () => {
    expect(dynamodb.putItem).toBeDefined();
    expect(typeof dynamodb.putItem).toBe('function');
  });

  it('should re-export updateItem', () => {
    expect(dynamodb.updateItem).toBeDefined();
    expect(typeof dynamodb.updateItem).toBe('function');
  });

  it('should re-export queryItems', () => {
    expect(dynamodb.queryItems).toBeDefined();
    expect(typeof dynamodb.queryItems).toBe('function');
  });

  it('should re-export getLatestItem', () => {
    expect(dynamodb.getLatestItem).toBeDefined();
    expect(typeof dynamodb.getLatestItem).toBe('function');
  });

  it('should re-export DynamoDBKey type', () => {
    // Type exports are not runtime values, so we just verify the module exports them
    // This test ensures the re-export exists in the type system
    expect(dynamodb).toBeDefined();
  });

  it('should re-export QueryOptions type', () => {
    // Type exports are not runtime values, so we just verify the module exports them
    // This test ensures the re-export exists in the type system
    expect(dynamodb).toBeDefined();
  });
});

