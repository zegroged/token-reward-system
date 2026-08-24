import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
    services: {
      web: 'up',
      // db ve redis kontrolü production'da eklenecek
    },
  });
}
