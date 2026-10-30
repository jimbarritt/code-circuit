class ActivityPub::DeliveryWorker
  include Sidekiq::Worker

  sidekiq_options queue: :push, retry: 16

  def perform(json, source_id, inbox_url)
    Request.new(:post, inbox_url, body: json).perform
  end
end
